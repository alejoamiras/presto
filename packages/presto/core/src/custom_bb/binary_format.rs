//! Executable-format check: the header must name Presto's own OS format and architecture, so a
//! wrong download or a cross-build is refused before anything runs it.

use std::io::Read;
use std::path::Path;

use super::{Refusal, RefusalCode};

/// Enough for every header below; PE's `e_lfanew` points past the DOS stub, normally under 0x200.
const HEAD_BYTES: u64 = 4096;
/// Real universal binaries carry two or three slices; more means this is not one.
const MAX_FAT_SLICES: usize = 16;
/// Load commands beyond this are not a program Presto could run.
#[cfg(target_os = "macos")]
const MAX_LOAD_COMMAND_BYTES: u64 = 1 << 20;
#[cfg(any(target_os = "macos", test))]
const LC_CODE_SIGNATURE: u32 = 0x1D;
#[cfg(any(target_os = "macos", test))]
const CPU_X86_64: u32 = 0x0100_0007;
#[cfg(any(target_os = "macos", test))]
const CPU_ARM64: u32 = 0x0100_000C;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Format {
    Elf,
    MachO,
    Pe,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Arch {
    X86_64,
    Aarch64,
    Other,
}

#[derive(Debug, PartialEq, Eq)]
enum Header {
    Binary(Format, Vec<Arch>),
    Script,
    Unknown,
}

pub(super) fn check_host(path: &Path) -> Result<(), Refusal> {
    let mut head = Vec::new();
    std::fs::File::open(path)
        .and_then(|f| f.take(HEAD_BYTES).read_to_end(&mut head))
        .map_err(|e| Refusal::unreadable(path, &e))?;
    let Some((host_format, host_arch, os_name)) = host() else {
        return Ok(());
    };
    match parse(&head) {
        Header::Binary(format, arches) if format == host_format => {
            if arches.contains(&host_arch) {
                Ok(())
            } else {
                Err(Refusal::new(
                    RefusalCode::WrongArchitecture,
                    format!(
                        "This program is built for {}, but Presto runs on {}.",
                        describe(&arches),
                        arch_name(host_arch)
                    ),
                    None,
                ))
            }
        }
        Header::Script => Err(Refusal::new(
            RefusalCode::WrongFormat,
            "This is a script, not a compiled bb.".to_string(),
            None,
        )),
        _ => Err(Refusal::new(
            RefusalCode::WrongFormat,
            format!("This is not a {os_name} program."),
            None,
        )),
    }
}

fn host() -> Option<(Format, Arch, &'static str)> {
    let arch = if cfg!(target_arch = "x86_64") {
        Arch::X86_64
    } else if cfg!(target_arch = "aarch64") {
        Arch::Aarch64
    } else {
        return None;
    };
    if cfg!(target_os = "linux") {
        Some((Format::Elf, arch, "Linux"))
    } else if cfg!(target_os = "macos") {
        Some((Format::MachO, arch, "macOS"))
    } else if cfg!(windows) {
        Some((Format::Pe, arch, "Windows"))
    } else {
        None
    }
}

fn parse(head: &[u8]) -> Header {
    if head.starts_with(b"#!") {
        return Header::Script;
    }
    let parsed = match head {
        [0x7F, b'E', b'L', b'F', ..] => parse_elf(head),
        [b'M', b'Z', ..] => parse_pe(head),
        _ => parse_mach_o(head),
    };
    parsed.unwrap_or(Header::Unknown)
}

fn parse_elf(head: &[u8]) -> Option<Header> {
    let raw = *head.get(18..20)?.first_chunk::<2>()?;
    let machine = match head.get(5)? {
        1 => u16::from_le_bytes(raw),
        2 => u16::from_be_bytes(raw),
        _ => return None,
    };
    let arch = match machine {
        62 => Arch::X86_64,
        183 => Arch::Aarch64,
        _ => Arch::Other,
    };
    Some(Header::Binary(Format::Elf, vec![arch]))
}

fn parse_pe(head: &[u8]) -> Option<Header> {
    let e_lfanew = u32::from_le_bytes(*head.get(0x3C..0x40)?.first_chunk::<4>()?) as usize;
    let signature = head.get(e_lfanew..e_lfanew.checked_add(6)?)?;
    if &signature[..4] != b"PE\0\0" {
        return None;
    }
    let arch = match u16::from_le_bytes([signature[4], signature[5]]) {
        0x8664 => Arch::X86_64,
        0xAA64 => Arch::Aarch64,
        _ => Arch::Other,
    };
    Some(Header::Binary(Format::Pe, vec![arch]))
}

fn parse_mach_o(head: &[u8]) -> Option<Header> {
    let magic = *head.get(0..4)?.first_chunk::<4>()?;
    let cpu = |at: usize, big_endian: bool| -> Option<Arch> {
        let raw = *head.get(at..at + 4)?.first_chunk::<4>()?;
        let value = if big_endian {
            u32::from_be_bytes(raw)
        } else {
            u32::from_le_bytes(raw)
        };
        Some(match value {
            0x0100_0007 => Arch::X86_64,
            0x0100_000C => Arch::Aarch64,
            _ => Arch::Other,
        })
    };
    match u32::from_le_bytes(magic) {
        // Thin images are stored in the target's byte order, little-endian on every Mac Presto runs on.
        0xFEED_FACF | 0xFEED_FACE => Some(Header::Binary(Format::MachO, vec![cpu(4, false)?])),
        _ => {
            let stride = match u32::from_be_bytes(magic) {
                0xCAFE_BABE => 20,
                0xCAFE_BABF => 32,
                _ => return None,
            };
            let slices = u32::from_be_bytes(*head.get(4..8)?.first_chunk::<4>()?) as usize;
            if slices == 0 || slices > MAX_FAT_SLICES {
                return None;
            }
            let arches = (0..slices)
                .map(|i| cpu(8 + i * stride, true))
                .collect::<Option<Vec<_>>>()?;
            Some(Header::Binary(Format::MachO, arches))
        }
    }
}

/// Whether the image Presto would run carries an `LC_CODE_SIGNATURE` load command with data. Apple
/// silicon refuses to start an image without one and accepts an ad-hoc signature, Aztec's own bb
/// builds included, whose certificate-less, unflagged signature Security.framework calls unsigned;
/// so this asks for presence only, and the test run lets the kernel judge validity.
#[cfg(target_os = "macos")]
pub(super) fn has_code_signature(path: &Path) -> std::io::Result<bool> {
    use std::io::{Seek, SeekFrom};
    let wanted = if cfg!(target_arch = "aarch64") {
        CPU_ARM64
    } else {
        CPU_X86_64
    };
    let mut file = std::fs::File::open(path)?;
    let mut head = Vec::new();
    (&mut file).take(HEAD_BYTES).read_to_end(&mut head)?;
    let Some((offset, size)) = host_slice(&head, wanted) else {
        return Ok(false);
    };
    file.seek(SeekFrom::Start(offset))?;
    let mut image = Vec::new();
    file.take(size.min(32 + MAX_LOAD_COMMAND_BYTES))
        .read_to_end(&mut image)?;
    Ok(signature_command(&image).is_some_and(|datasize| datasize > 0))
}

/// Where the `wanted` architecture's image lies, as (offset, size): the whole file for a thin
/// image, its slice for a fat one.
#[cfg(any(target_os = "macos", test))]
fn host_slice(head: &[u8], wanted: u32) -> Option<(u64, u64)> {
    let magic = *head.get(0..4)?.first_chunk::<4>()?;
    if matches!(u32::from_le_bytes(magic), 0xFEED_FACF | 0xFEED_FACE) {
        return Some((0, u64::MAX));
    }
    let stride = match u32::from_be_bytes(magic) {
        0xCAFE_BABE => 20,
        0xCAFE_BABF => 32,
        _ => return None,
    };
    let slices = u32::from_be_bytes(*head.get(4..8)?.first_chunk::<4>()?) as usize;
    if slices == 0 || slices > MAX_FAT_SLICES {
        return None;
    }
    let be32 = |at: usize| {
        Some(u64::from(u32::from_be_bytes(
            *head.get(at..at + 4)?.first_chunk::<4>()?,
        )))
    };
    let be64 = |at: usize| {
        Some(u64::from_be_bytes(
            *head.get(at..at + 8)?.first_chunk::<8>()?,
        ))
    };
    (0..slices).map(|i| 8 + i * stride).find_map(|at| {
        if be32(at)? != u64::from(wanted) {
            return None;
        }
        Some(if stride == 20 {
            (be32(at + 8)?, be32(at + 12)?)
        } else {
            (be64(at + 8)?, be64(at + 16)?)
        })
    })
}

/// The `datasize` of a 64-bit image's `LC_CODE_SIGNATURE` command, if it has one. The declared
/// command region must fit the image and each command its region before anything in it is read,
/// so a header that lies about its sizes names no signature.
#[cfg(any(target_os = "macos", test))]
fn signature_command(image: &[u8]) -> Option<u32> {
    let word = |at: usize| {
        Some(u32::from_le_bytes(
            *image.get(at..at + 4)?.first_chunk::<4>()?,
        ))
    };
    if word(0)? != 0xFEED_FACF {
        return None;
    }
    let ncmds = word(16)?;
    let end = 32usize
        .checked_add(word(20)? as usize)
        .filter(|&end| end <= image.len())?;
    let mut at = 32usize;
    for _ in 0..ncmds {
        let (cmd, size) = (word(at)?, word(at + 4)? as usize);
        let next = at
            .checked_add(size)
            .filter(|&next| size >= 8 && next <= end)?;
        if cmd == LC_CODE_SIGNATURE {
            return if size >= 16 { word(at + 12) } else { None };
        }
        at = next;
    }
    None
}

fn arch_name(arch: Arch) -> &'static str {
    match arch {
        Arch::X86_64 => "x86-64",
        Arch::Aarch64 => "ARM64",
        Arch::Other => "another processor",
    }
}

fn describe(arches: &[Arch]) -> String {
    let mut names: Vec<&str> = arches.iter().map(|a| arch_name(*a)).collect();
    names.dedup();
    names.join(" and ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn elf(machine: u16) -> Vec<u8> {
        let mut h = vec![0u8; 64];
        h[..4].copy_from_slice(b"\x7FELF");
        h[4] = 2;
        h[5] = 1;
        h[18..20].copy_from_slice(&machine.to_le_bytes());
        h
    }

    fn pe(machine: u16) -> Vec<u8> {
        let mut h = vec![0u8; 0x100];
        h[..2].copy_from_slice(b"MZ");
        h[0x3C..0x40].copy_from_slice(&0x80u32.to_le_bytes());
        h[0x80..0x84].copy_from_slice(b"PE\0\0");
        h[0x84..0x86].copy_from_slice(&machine.to_le_bytes());
        h
    }

    fn fat(cpus: &[u32]) -> Vec<u8> {
        let mut h = Vec::new();
        h.extend_from_slice(&0xCAFE_BABEu32.to_be_bytes());
        h.extend_from_slice(&(cpus.len() as u32).to_be_bytes());
        for cpu in cpus {
            h.extend_from_slice(&cpu.to_be_bytes());
            h.extend_from_slice(&[0u8; 16]);
        }
        h
    }

    #[test]
    fn headers_name_their_format_and_architectures() {
        use Arch::*;
        let bin = |f, a: &[Arch]| Header::Binary(f, a.to_vec());
        assert_eq!(parse(&elf(62)), bin(Format::Elf, &[X86_64]));
        assert_eq!(parse(&elf(183)), bin(Format::Elf, &[Aarch64]));
        assert_eq!(parse(&elf(40)), bin(Format::Elf, &[Other]));
        assert_eq!(parse(&pe(0x8664)), bin(Format::Pe, &[X86_64]));
        assert_eq!(parse(&pe(0xAA64)), bin(Format::Pe, &[Aarch64]));

        let mut thin = 0xFEED_FACFu32.to_le_bytes().to_vec();
        thin.extend_from_slice(&0x0100_000Cu32.to_le_bytes());
        assert_eq!(parse(&thin), bin(Format::MachO, &[Aarch64]));
        assert_eq!(
            parse(&fat(&[0x0100_0007, 0x0100_000C])),
            bin(Format::MachO, &[X86_64, Aarch64])
        );

        assert_eq!(parse(b"#!/bin/sh\necho 1\n"), Header::Script);
        assert_eq!(parse(b"plain text"), Header::Unknown);
    }

    /// A 64-bit arm64 image whose load commands are `cmds`, each `(cmd, payload)`.
    fn thin_image(cmds: &[(u32, &[u8])]) -> Vec<u8> {
        let mut body = Vec::new();
        for (cmd, payload) in cmds {
            body.extend_from_slice(&cmd.to_le_bytes());
            body.extend_from_slice(&(8 + payload.len() as u32).to_le_bytes());
            body.extend_from_slice(payload);
        }
        let mut image = Vec::new();
        for word in [
            0xFEED_FACFu32,
            CPU_ARM64,
            0,
            2,
            cmds.len() as u32,
            body.len() as u32,
            0,
            0,
        ] {
            image.extend_from_slice(&word.to_le_bytes());
        }
        image.extend_from_slice(&body);
        image
    }

    #[test]
    fn a_signature_command_is_found_only_when_present_and_sized() {
        let signed: &[u8] = &[4, 0, 0, 0, 16, 0, 0, 0];
        let empty: &[u8] = &[4, 0, 0, 0, 0, 0, 0, 0];
        let segment: &[u8] = &[0u8; 64];
        let signed_image = thin_image(&[(0x19, segment), (LC_CODE_SIGNATURE, signed)]);
        assert_eq!(signature_command(&signed_image), Some(16));
        assert_eq!(
            signature_command(&thin_image(&[(LC_CODE_SIGNATURE, empty)])),
            Some(0)
        );
        assert_eq!(signature_command(&thin_image(&[(0x19, segment)])), None);
        assert_eq!(signature_command(&thin_image(&[])), None);
        // Truncated commands, a command region the image cannot hold, a zero-sized command, a
        // short signature command, a region that lies about its size, and a 32-bit header end the
        // walk without a hit.
        assert_eq!(signature_command(&signed_image[..40]), None);
        let wide: &[u8] = &[4, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        let cut = thin_image(&[(LC_CODE_SIGNATURE, wide)]);
        assert_eq!(signature_command(&cut), Some(16));
        assert_eq!(signature_command(&cut[..48]), None);
        let mut looped = signed_image.clone();
        looped[36..40].copy_from_slice(&0u32.to_le_bytes());
        assert_eq!(signature_command(&looped), None);
        assert_eq!(
            signature_command(&thin_image(&[(LC_CODE_SIGNATURE, &[])])),
            None
        );
        let mut hollow = thin_image(&[(LC_CODE_SIGNATURE, signed)]);
        hollow[20..24].copy_from_slice(&0u32.to_le_bytes());
        hollow[36..40].copy_from_slice(&0u32.to_le_bytes());
        assert_eq!(signature_command(&hollow), None);
        let mut narrow = thin_image(&[(LC_CODE_SIGNATURE, signed)]);
        narrow[..4].copy_from_slice(&0xFEED_FACEu32.to_le_bytes());
        assert_eq!(signature_command(&narrow), None);
    }

    #[test]
    fn the_host_slice_is_the_thin_image_or_the_matching_fat_slice() {
        assert_eq!(host_slice(&thin_image(&[]), CPU_ARM64), Some((0, u64::MAX)));
        let mut fat = fat(&[CPU_X86_64, CPU_ARM64]);
        fat[16..20].copy_from_slice(&4096u32.to_be_bytes());
        fat[20..24].copy_from_slice(&12288u32.to_be_bytes());
        fat[36..40].copy_from_slice(&16384u32.to_be_bytes());
        fat[40..44].copy_from_slice(&23_000_000u32.to_be_bytes());
        assert_eq!(host_slice(&fat, CPU_ARM64), Some((16384, 23_000_000)));
        assert_eq!(host_slice(&fat, CPU_X86_64), Some((4096, 12288)));
        assert_eq!(host_slice(&fat, 0x0100_0012), None);
        assert_eq!(host_slice(&fat[..30], CPU_ARM64), None);
        assert_eq!(host_slice(b"plain text", CPU_ARM64), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_system_binary_carries_a_code_signature() {
        assert!(has_code_signature(Path::new("/bin/ls")).unwrap());
    }

    #[test]
    fn truncated_or_implausible_headers_are_unknown_not_a_panic() {
        assert_eq!(parse(&elf(62)[..19]), Header::Unknown);
        assert_eq!(parse(&pe(0x8664)[..0x82]), Header::Unknown);
        assert_eq!(parse(b"MZ"), Header::Unknown);
        let mut far = pe(0x8664);
        far[0x3C..0x40].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(parse(&far), Header::Unknown);
        // A Java class file shares the fat magic; its version field reads as dozens of slices.
        let mut class = 0xCAFE_BABEu32.to_be_bytes().to_vec();
        class.extend_from_slice(&[0, 0, 0, 0x41]);
        assert_eq!(parse(&class), Header::Unknown);
        assert_eq!(parse(&fat(&[0x0100_000C])[..10]), Header::Unknown);
    }
}

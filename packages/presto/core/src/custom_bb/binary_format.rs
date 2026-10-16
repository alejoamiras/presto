//! Executable-format check: the header must name Presto's own OS format and architecture, so a
//! wrong download or a cross-build is refused before anything runs it.

use std::io::Read;
use std::path::Path;

use super::{Refusal, RefusalCode};

/// Enough for every header below; PE's `e_lfanew` points past the DOS stub, normally under 0x200.
const HEAD_BYTES: u64 = 4096;
/// Real universal binaries carry two or three slices; more means this is not one.
const MAX_FAT_SLICES: usize = 16;

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

// 1,024 dependent rounds (~2^18 gates): ~10 s in bb.js WASM vs ~2 s in native bb, so the
// playground shows the gap.
global ROUNDS: u32 = 1024;

fn main(x: Field, y: pub Field) -> pub Field {
    let mut h = x;
    for _ in 0..ROUNDS {
        h = std::hash::pedersen_hash([h, y]);
    }
    h
}

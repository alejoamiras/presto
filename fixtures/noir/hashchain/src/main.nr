// Heavy enough that native bb visibly beats WASM: a dependent chain of Pedersen hashes, so no
// step can be evaluated ahead of the previous one. Public inputs: `y` and the final digest.
global ROUNDS: u32 = 1024;

fn main(x: Field, y: pub Field) -> pub Field {
    let mut h = x;
    for _ in 0..ROUNDS {
        h = std::hash::pedersen_hash([h, y]);
    }
    h
}

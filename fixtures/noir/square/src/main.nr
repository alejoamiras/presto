// Small but not trivial: one Pedersen hash plus a square check. Public inputs: `y` and the returned hash.
fn main(x: Field, y: pub Field) -> pub Field {
    assert(x * x == y);
    std::hash::pedersen_hash([x, y])
}

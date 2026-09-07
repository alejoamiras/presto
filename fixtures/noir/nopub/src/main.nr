// Zero public inputs: probes bb's `public_inputs` output for the empty case.
fn main(x: Field, y: Field) {
    assert(x * y == 42);
}

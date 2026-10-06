# Code review: v1.1-r6

Package version remains 1.1.0; catiaAeroRevision is r6. See REVIEW_r6.md for the findings, changes and limits.

Assembly generation and guards live in assembly-ops.js, placement conversion in transforms.js, shared strict validation in validation.js, and read-only screening in rules.js. Modelling and screening share the endplate/diffuser contours and profile placement geometry. Existing ledgers retain their dependencies; newly expanded multi-element wings use a serial flap chain.

Point/line regional tests clip exact segments. Interpolated splines and lofts remain uncertified: their input-point boxes cannot establish final surface containment. Rule screening reports partial results for these elements. STEP envelopes remain approximate and source units are not converted.

Assembly replacement inserts and positions the new component before removing the old one; it does not guarantee constraint or publication preservation. All mutations are procedure-guarded; failures may leave session changes and are reported accordingly. New CATProduct files retain external references rather than collecting them.

Project paths reject existing symlinks/junctions and nonportable names; this is not protection against hostile concurrent filesystem changes. Scripts/reports use Unicode encoding, literals escape control characters, and saved output paths are rechecked. No installation, live CATIA test, or GitHub push was performed.

Nine offline suites passed; the DSH compiler comparison and historical real-vehicle benchmarks were not run. Delivery includes an offline verifier, read-only environment doctor, standalone geometry CLI, portable ZIP packaging and per-file SHA256 checksums.

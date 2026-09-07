# Unicode 16 general-category tables

These runtime tables are exact vendored copies of the `General_Category/{Letter,Mark,Number}/regex.js` modules from `@unicode/unicode-16.0.0@2.0.2`. The npm package remains a dev dependency so the source is reproducible without adding its full generated data tree to Desk's production runtime packs.

- `letter.cjs`: `sha256:57b42eb5efb05e70fd7378a7998cd4502516ecffaa6ab1119255e45a49077ad4`
- `mark.cjs`: `sha256:bcd99fa2bda1cc7b38be4a6d3f4713c96701bb42bfd7066b91d305e11eb3b48d`
- `number.cjs`: `sha256:c9ed76f5842d76210411b7e46162a7b3c4b47196469d5c014a887bba762263f2`

To refresh them, install the locked dev dependency, copy the three source modules to the matching `.cjs` files, and update these hashes. The generated data package is MIT-licensed by Mathias Bynens; see `LICENSE-MIT.txt`.

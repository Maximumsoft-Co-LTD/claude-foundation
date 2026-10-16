# Changelog

## 2.0.0

### Breaking changes

- `slugify(input, options)` is renamed to `toSlug(input, options)`. The old name
  is removed.
- `toSlug` truncates slugs to `maxLength` characters (default `64`) and trims a
  trailing separator after truncation. Pass `maxLength: 0` to disable
  truncation and keep the 1.x behavior.
- `toSlug` validates `maxLength` and throws `RangeError` for negative or
  non-integer values.

### Unchanged

- Accent folding, lowercasing, word splitting and the `separator` option.

## 1.0.0

- Initial release with `slugify(input, { separator })`.

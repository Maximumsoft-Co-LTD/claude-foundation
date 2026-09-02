# Behavior-preserving normalization refactor

Remove the duplicated normalization implementation through one internal
abstraction. Preserve all four exports and their null, whitespace, casing, and
Unicode behavior. Add characterization tests before changing the structure.

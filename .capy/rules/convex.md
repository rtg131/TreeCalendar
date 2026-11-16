---
description: Convex conventions
globs:
  - "convex/**/*.ts"
---

- Network calls only in actions, never in queries or mutations.
- Put "use node" at the top of files that need Node packages, and keep those files to actions only.
- Validators on every function argument (and return values where practical).

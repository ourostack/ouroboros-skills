# ouroboros-skills — `v2-alpha` has moved

Agentic Engineering V2 (Desk, Crew, Superpowers and Plain Language) now lives in **[ourostack/desk](https://github.com/ourostack/desk)**, where `main` is the V2 channel. This `v2-alpha` branch receives no further releases. Its final Desk release, `3.2.0-alpha.10.1`, moves existing installs to the new home.

- **Set up a new machine:** give your agent [ourostack/desk SETUP.md](https://github.com/ourostack/desk/blob/main/SETUP.md) and say "set this up".
- **Move an existing install:** update Desk and start a new session. Desk tells the agent to run the `move-to-ourostack-desk` migration (`desk:session-start-migrations`). The migration reinstalls Desk and its companions from `@ourostack` with automatic updates on, carries your desk binding over, removes the old `@ouroboros-skills` copies (keeping any that a remaining V1 plugin such as Work Suite needs, and telling you how to remove them later), and rewrites Agency `agency.toml` entries that track `@v2-alpha` to `github:ourostack/desk:plugins/<name>@main`, keeping a `.pre-ourostack-desk` backup. Restart the session when it finishes.
- **Read the V2 RFC:** [Agentic Engineering V2](https://github.com/ourostack/desk/blob/main/plugins/desk/docs/agentic-engineering-v2-rfc.md).

The V1 skill catalog is on this repository's [`main` branch](https://github.com/ourostack/ouroboros-skills/tree/main).

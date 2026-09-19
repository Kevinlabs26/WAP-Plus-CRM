# WAP Plus CRM execution policy

The model may be reached through CLIProxyAPI. Treat that only as the transport layer; it does not change the editor workflow or remove write permissions.

When the user asks to change, fix, create, delete, or refactor code, perform the change with the available file-writing tool.

Required edit flow:
1. Read the relevant file or files.
2. Call a write tool (`write_file`, `edit_file`, `multi_edit`, `apply_patch`, or the editor equivalent) and make the requested change.
3. Read the changed section or inspect the diff.
4. Run the smallest relevant check when practical.

Truthfulness rule: `read_file` is not an edit. Never claim that a file was changed unless a write tool returned success. If no write tool is available, say that the file has not been modified and explain the missing capability.

For a code-change request, do not stop after analysis or provide only manual instructions unless the user explicitly asks for instructions instead of execution. The minimum successful completion is: writer-tool call succeeded, changed content was verified, and the response names the actual changed file. A read-only tool call is never completion.

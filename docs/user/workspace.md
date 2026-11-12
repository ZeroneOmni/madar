# Your workspace

Madar's workspace provides navigation, commands, preferences, router connections, and operation notifications. Voucher, subscription, card-design, and usage operations are not available yet.

Use **Manage connections** in the header or command palette to save a connection, then select it in the header. Enter its password and choose **Connect**. Names, addresses, usernames, descriptions, colors, and icons are saved on this device; passwords are not saved. Editing the active connection disconnects it.

For a RouterOS 6 **User Manager account (/userman)**, enter the User Manager host, its web port, and the account you use at `/userman`. Choose HTTP (normally port 80) or HTTPS (normally port 443); HTTPS requires a trusted certificate. HTTP transmits login details without encryption. Madar confirms the customer session before displaying verified User Manager access. Voucher and subscription operations are not available yet.

**Router API account** is a separate connection method for router credentials. API-SSL normally uses port 8729; unencrypted API normally uses 8728. This connection checks router identity and version and does not verify a User Manager account (/userman). Existing saved router API connections retain their method.

Access is checked every 30 seconds. Temporary failures retry up to five times, with a short delay before displaying an interruption. Use **Connection diagnosis**, **Copy diagnostics**, and **Retry connection** to investigate and recover; copied diagnostics exclude passwords, usernames, names, and host addresses.

Use **Organize navigation** to change destination order or create named groups. You can also drag destinations between rows and groups. Removing a group keeps its destinations in the workspace. Navigation and preferences are saved locally; a failed save leaves the previous saved value in use.

Switch the sidebar to compact mode to give the workspace more room. Its icons keep every destination available, including pages in folded groups; hover an icon to see its name.

Open the command palette with **Ctrl+K** on Windows/Linux or **Command+K** on macOS. Change or reset shortcuts in **Settings > Keyboard shortcuts**. Select a shortcut, press the new combination, then save; Escape cancels recording. Add bindings for unassigned commands with **Add keybinding**, or remove and reset bindings from their row menu. Navigation shortcuts pause while typing; the command palette and Settings shortcuts remain available.

Choose **English** or **العربية** in **Settings > General > Language**. Arabic uses a right-to-left layout. Your choice takes effect immediately and is remembered on this device. The welcome screen also offers this choice; the first launch follows your system language when supported.

Search in Settings to jump directly to a preference. Settings links preserve their section and target when reopened. In **Settings > Privacy**, workspace overrides take precedence over application defaults; **Use application default** restores inheritance. Masking hides values on screen, while Copy copies the original value.

Results from preference changes and app updates appear in **Notifications**. You can mark them read or unread, open their related page, or dismiss them. In-app toasts and background desktop notifications can be configured separately in **Settings > Notifications**. Operating-system permissions and Do Not Disturb may suppress desktop delivery; delivery failures offer a retry.

Revisit the introduction or restart setup in **Settings > General**. Completing setup is saved only when local storage accepts the change.

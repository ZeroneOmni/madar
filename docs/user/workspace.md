# Your workspace

Madar's workspace provides navigation, commands, preferences, router connections, and operation notifications. Voucher, subscription, card-design, and usage operations are not available yet.

Use **Manage routers** in the header or command palette to save a RouterOS 6 router, then select it in the header. Enter its password and choose **Connect**. Names, addresses, usernames, labels, colors, and icons are saved on this device; passwords last only until you disconnect, switch routers, or close the app. Editing the active router disconnects it.

Enable the router's binary API service before connecting. API-SSL defaults to port 8729 and requires a trusted certificate matching the hostname. Unencrypted API defaults to port 8728 and sends credentials over the network. Connected means Madar successfully authenticated and read the router identity and version; it does not confirm User Manager availability. Access is checked every 30 seconds. Temporary failures retry up to five times, with a short delay before displaying an interruption. Use **Connection diagnosis**, **Copy diagnostics**, and **Retry connection** to investigate and recover; copied diagnostics exclude passwords, usernames, names, and host addresses.

Use **Organize navigation** to change destination order or create named groups. You can also drag destinations between rows and groups. Removing a group keeps its destinations in the workspace. Navigation and preferences are saved locally; a failed save leaves the previous saved value in use.

Switch the sidebar to compact mode to give the workspace more room. Its icons keep every destination available, including pages in folded groups; hover an icon to see its name.

Open the command palette with **Ctrl+K** on Windows/Linux or **Command+K** on macOS. Change or reset shortcuts in **Settings > Keyboard shortcuts**. Select a shortcut, press the new combination, then save; Escape cancels recording. Add bindings for unassigned commands with **Add keybinding**, or remove and reset bindings from their row menu. Navigation shortcuts pause while typing; the command palette and Settings shortcuts remain available.

Choose **English** or **العربية** in **Settings > General > Language**. Arabic uses a right-to-left layout. Your choice takes effect immediately and is remembered on this device. The welcome screen also offers this choice; the first launch follows your system language when supported.

Search in Settings to jump directly to a preference. Settings links preserve their section and target when reopened. In **Settings > Privacy**, workspace overrides take precedence over application defaults; **Use application default** restores inheritance. Masking hides values on screen, while Copy copies the original value.

Results from preference changes and app updates appear in **Notifications**. You can mark them read or unread, open their related page, or dismiss them. In-app toasts and background desktop notifications can be configured separately in **Settings > Notifications**. Operating-system permissions and Do Not Disturb may suppress desktop delivery; delivery failures offer a retry.

Revisit the introduction or restart setup in **Settings > General**. Completing setup is saved only when local storage accepts the change.

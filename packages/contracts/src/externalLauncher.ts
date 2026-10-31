import * as Schema from "effect/Schema";

export class ExternalLauncherBrowserSpawnError extends Schema.TaggedError<ExternalLauncherBrowserSpawnError>()(
  "ExternalLauncherBrowserSpawnError",
  {
    command: Schema.String,
    args: Schema.Array(Schema.String),
    cause: Schema.Defect(),
    target: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to launch browser target '${this.target}' with '${[this.command, ...this.args].join(" ")}'`;
  }
}

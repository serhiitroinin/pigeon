import chalk from "chalk";

export function table(
  headers: string[],
  rows: (string | number | boolean | undefined | null)[][]
): void {
  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(
      h.length,
      ...rows.map((r) => String(r[i] ?? "").length)
    )
  );

  // Print header
  const headerLine = headers
    .map((h, i) => chalk.bold(h.padEnd(widths[i]!)))
    .join("  ");
  console.log(headerLine);
  console.log(widths.map((w) => "─".repeat(w)).join("  "));

  // Print rows
  for (const row of rows) {
    const line = row
      .map((cell, i) => String(cell ?? "").padEnd(widths[i]!))
      .join("  ");
    console.log(line);
  }
}

export function heading(text: string): void {
  console.log(chalk.bold.cyan(text));
}

export function subheading(text: string): void {
  console.log(chalk.bold(text));
}

export function success(text: string): void {
  console.log(chalk.green(text));
}

export function error(text: string): void {
  console.error(chalk.red(`Error: ${text}`));
}

export function info(text: string): void {
  console.log(chalk.dim(text));
}

export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function blank(): void {
  console.log();
}

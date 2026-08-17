/** Summarizes exported values from a fixture module. */
export function greet(name: string): string {
  return `hello ${name}`;
}

export class Greeter {
  /** Greets with a prefix. */
  greet(name: string): string {
    return `hi ${name}`;
  }
}

export type Greeting = string;

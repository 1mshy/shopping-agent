// The WHATWG URL API exists in every JavaScript runtime this code runs on. It is declared here,
// and nothing else is, because this package loads neither Node nor DOM types (CONTRIBUTING rule
// 5). Parsing a URL is not I/O. Do not add a declaration for anything that reads a clock, a
// file, the network or the environment.

declare class URLSearchParams implements Iterable<[string, string]> {
  constructor(
    init?: string | Record<string, string> | Iterable<[string, string]> | URLSearchParams,
  );
  readonly size: number;
  append(name: string, value: string): void;
  delete(name: string, value?: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string, value?: string): boolean;
  set(name: string, value: string): void;
  sort(): void;
  toString(): string;
  forEach(callback: (value: string, name: string, parent: URLSearchParams) => void): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}

declare class URL {
  constructor(url: string | URL, base?: string | URL);
  static canParse(url: string | URL, base?: string | URL): boolean;
  static parse(url: string | URL, base?: string | URL): URL | null;
  hash: string;
  host: string;
  hostname: string;
  href: string;
  readonly origin: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  readonly searchParams: URLSearchParams;
  username: string;
  toString(): string;
  toJSON(): string;
}

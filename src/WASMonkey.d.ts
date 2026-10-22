// Type definitions for the WASMonkey Developer API (Phase 5).
// Drop this file into your script project for IntelliSense.

export interface LoadContext {
  /** URL of the WASM resource being loaded (when known). */
  url: string;
  /** Call stack captured at the load site. */
  initiatorStack: string | null;
  /** Byte length of the module. */
  byteLength: number;
  /** URL of the containing frame/page. */
  frameUrl: string;
}

export interface WASMonkeyStorage {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
}

export interface WASMonkeyUtils {
  findFunctionByExportName(module: any, name: string): number | null;
  replaceFunctionBody(module: any, index: number, newWatSnippet: string): boolean;
  patchConstant(bytes: Uint8Array, oldValue: number, newValue: number): Uint8Array;
  injectImportTrampoline(module: any, importName: string, jsCallback: Function): { importName: string; callback: Function; wired: boolean } | null;
  encodeUleb128(value: number): Uint8Array;
  decodeUleb128(bytes: Uint8Array, offset?: number): { value: number; next: number };
  encodeSleb128(value: number): Uint8Array;
  decodeSleb128(bytes: Uint8Array, offset?: number): { value: number; next: number };
}

export interface WASMonkeyAPI {
  readonly apiVersion: 1;
  log(...args: unknown[]): void;
  getBinaryen(): Promise<any>;
  getWabt(): Promise<any>;
  disassemble(bytes: Uint8Array): Promise<string>;
  assemble(wat: string): Promise<Uint8Array>;
  hashBytes(bytes: Uint8Array): Promise<string>;
  onBeforeInstantiate(cb: (bytes: Uint8Array, ctx: LoadContext) => Uint8Array | void | Promise<Uint8Array | void>): void;
  onAfterInstantiate(cb: (exports: WebAssembly.Exports, ctx: LoadContext) => void): void;
  storage: WASMonkeyStorage;
  utils: WASMonkeyUtils | null;
}

declare global {
  const WASMonkey: WASMonkeyAPI;
  interface Window {
    WASMonkey: WASMonkeyAPI;
    __WASMonkey: WASMonkeyAPI;
    __WASMonkeyModules: Array<{ byteLength: number; url: string; exports: string[] | null }>;
  }
}

export {};
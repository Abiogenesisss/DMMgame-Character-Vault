/** Only the host protocol is shared. Each game owns its catalogs and players. */
export interface GameInfo {
  id: string;
  name: string;
  label: string;
  root: string;
  revision: string;
  stylesheet: boolean;
}
export interface ServiceOptions {
  root: string;
  origin: string;
  fetchResource: (url: string, options?: RequestInit) => Promise<Response>;
}
export interface GameService { handle(request: Request): Promise<Response | null>; }
export interface GameAdapter {
  catalogHarImport?: boolean;
  createService(options: ServiceOptions): GameService;
  createDiscoveryService?(options: ServiceOptions): GameService;
  extract(root: string, progress: (state: unknown) => void): Promise<unknown> | unknown;
  initializeData?(root: string): void;
}

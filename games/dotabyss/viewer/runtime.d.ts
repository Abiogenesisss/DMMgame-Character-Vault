export {};
declare global {
  interface Window {
    Live2DCubismCore?: { Version: { csmGetVersion(): number } };
  }
}

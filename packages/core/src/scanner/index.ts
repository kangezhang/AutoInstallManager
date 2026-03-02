// Scanner module exports
export { Scanner } from './scanner';
export { detectVersion, detectVersions } from './version-detector';
export {
  findInPath,
  findExecutable,
  findAllExecutables,
  getSystemPaths,
  getExecutableExtensions,
} from './path-prober';
export {
  detectConflicts,
  detectDuplicateInstallations,
  detectPathConflicts,
} from './conflict-detector';



export {
  setupAuth,
  isAuthenticated,
  getSession,
  establishTesterSession,
  destroyTesterSession,
  authenticateWebSocketRequest,
} from "./replitAuth";
export { authStorage, type IAuthStorage } from "./storage";
export { registerAuthRoutes, isApproved } from "./routes";

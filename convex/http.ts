// HTTP router with Convex Auth routes.
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);

export default http;

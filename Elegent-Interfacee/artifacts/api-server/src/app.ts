import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import router from "./routes";

const app: Express = express();

app.set("trust proxy", 1);

app.use(cors({ origin: true, credentials: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "uql-studio-dev-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api", router);

export default app;

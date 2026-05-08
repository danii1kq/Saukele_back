const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const { port, allowedOrigins } = require("./config/config");
const authRoutes = require("./routes/auth");
const registriesRoutes = require("./routes/registries");
const giftItemsRoutes = require("./routes/giftItems");
const contributionsRoutes = require("./routes/contributions");
const familyMembersRoutes = require("./routes/familyMembers");
const adminRoutes = require("./routes/admin");

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS origin denied"));
    },
  })
);
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Saukele API is running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/registries", registriesRoutes);
app.use("/api", giftItemsRoutes);
app.use("/api", contributionsRoutes);
app.use("/api", familyMembersRoutes);
app.use("/api/admin", adminRoutes);

const swaggerDocument = YAML.load(path.join(__dirname, "../blueprint/openapi.yaml"));
swaggerDocument.servers = [{ url: `http://localhost:${port}/api` }];
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument, { explorer: true }));

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  void next;
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

module.exports = app;

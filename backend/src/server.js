import express from "express"
import dotenv from "dotenv";
import cors from "cors";
import router from "./routes/index.js";
import createData from "./config/elasticsearch.js";

dotenv.config()
const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json());
app.use("/api", router);

// Middlewares to prevent caching
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await createData();
});
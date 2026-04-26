import express from "express";
import * as productController from "../controllers/product.controller.js"

const productRouter = express.Router();

productRouter.get("/", productController.getAll);
productRouter.get("/suggest", productController.suggest);
productRouter.get("/:id", productController.getOne);

export default productRouter;
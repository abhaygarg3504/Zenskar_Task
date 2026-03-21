const express = require("express");
const app = express();
app.use(express.json());

const customers = [];
let idCounter = 1;

const API_KEY = "test-api-key-12345";

function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || authHeader === `Bearer ${API_KEY}`) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
}

app.use("/api/v1", authMiddleware);

app.post("/api/v1/customers", (req, res) => {
  const body = req.body;

  if (!body || !body.name || !body.email) {
    return res.status(400).json({ error: "name and email are required" });
  }

  const customer = {
    id: String(idCounter++),
    ...body,
    createdAt: new Date().toISOString(),
  };

  customers.push(customer);

  console.log(`[Mock API] Created customer: ${customer.name} (${customer.email}) → id=${customer.id}`);
  return res.status(201).json(customer);
});

app.get("/api/v1/customers", (req, res) => {
  return res.json(customers);
});

app.get("/api/v1/customers/:id", (req, res) => {
  const customer = customers.find((c) => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: "Not found" });
  return res.json(customer);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running at ${PORT}`);
});

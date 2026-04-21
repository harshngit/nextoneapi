const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Express PostgreSQL API",
      version: "1.0.0",
      description: "Auth & User Management REST API",
    },
    servers: [
      { url: "http://localhost:3000", description: "Local development server" },
      { url: "https://nextoneapi.onrender.com", description: "Production server" }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        RegisterRequest: {
          type: "object",
          required: ["email", "first_name", "last_name", "phone_number", "password", "role"],
          properties: {
            email: { type: "string", format: "email", example: "john@example.com" },
            first_name: { type: "string", example: "John" },
            last_name: { type: "string", example: "Doe" },
            phone_number: { type: "string", example: "+1234567890" },
            password: { type: "string", minLength: 6, example: "password123" },
            role: { type: "string", enum: ["superadmin", "admin", "sales_manager", "sales_executive", "external_caller"], example: "sales_executive" },
          },
        },
        LoginRequest: {
          type: "object",
          required: ["password"],
          properties: {
            email: { type: "string", format: "email", example: "john@example.com" },
            phone_number: { type: "string", example: "+1234567890" },
            password: { type: "string", example: "password123" },
          },
        },
        ForgotPasswordRequest: {
          type: "object",
          required: ["email"],
          properties: { email: { type: "string", format: "email" } },
        },
        ChangePasswordRequest: {
          type: "object",
          required: ["token", "new_password"],
          properties: {
            token: { type: "string" },
            new_password: { type: "string", minLength: 6 },
          },
        },
        UpdateUserRequest: {
          type: "object",
          properties: {
            first_name: { type: "string" },
            last_name: { type: "string" },
            phone_number: { type: "string" },
            language_preferences: { type: "array", items: { type: "string" }, example: ["en", "hi"] },
            regions: { type: "array", items: { type: "string" }, example: ["IN", "US"] },
          },
        },
        User: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            email: { type: "string" },
            first_name: { type: "string" },
            last_name: { type: "string" },
            phone_number: { type: "string" },
            role: { type: "string" },
            language_preferences: { type: "array", items: { type: "string" } },
            regions: { type: "array", items: { type: "string" } },
            is_active: { type: "boolean" },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
        },
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string" },
            data: { type: "object" },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string" },
          },
        },
      },
    },
  },
  apis: ["./src/routes/*.js"],
};

const swaggerSpec = swaggerJsdoc(options);
module.exports = swaggerSpec;

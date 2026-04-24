const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Next One Realty API",
      version: "1.0.0",
      description: "Auth & User Management REST API",
    },
    servers: [
      { url: "http://localhost:3000", description: "Local development server" },
      { url: "https://nextoneapi.onrender.com", description: "Production server" }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
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
            password: { type: "string", minLength: 8, example: "Password@123" },
            role: {
              type: "string",
              enum: [
                "super_admin",
                "admin",
                "sales_manager",
                "sales_executive",
                "external_caller"
              ],
              example: "sales_executive",
              description: "Allowed roles: super_admin, admin, sales_manager, sales_executive, external_caller"
            },
          },
        },
        LoginRequest: {
          type: "object",
          required: ["password"],
          properties: {
            email: { type: "string", format: "email", example: "john@example.com" },
            phone_number: { type: "string", example: "+1234567890" },
            password: { type: "string", example: "Password@123" },
          },
        },
        LoginResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string", example: "Login successful" },
            data: {
              type: "object",
              properties: {
                access_token: { type: "string" },
                refresh_token: { type: "string" },
                expires_in: { type: "string", example: "7d" },
                user: { $ref: "#/components/schemas/User" },
              },
            },
          },
        },
        ForgotPasswordRequest: {
          type: "object",
          required: ["email"],
          properties: { email: { type: "string", format: "email" } },
        },
        ChangePasswordRequest: {
          type: "object",
          required: ["current_password", "new_password"],
          properties: {
            current_password: { type: "string", example: "OldPass@123" },
            new_password: { type: "string", minLength: 8, example: "NewPass@456" },
          },
        },
        UpdateUserRequest: {
          type: "object",
          properties: {
            first_name: { type: "string" },
            last_name: { type: "string" },
            phone_number: { type: "string" },
            manager_id: { type: "string", format: "uuid" },
          },
        },
        UpdateRoleRequest: {
          type: "object",
          required: ["role"],
          properties: {
            role: {
              type: "string",
              enum: [
                "super_admin",
                "admin",
                "sales_manager",
                "sales_executive",
                "external_caller"
              ],
              example: "sales_manager",
            },
          },
        },
        CreateUserRequest: {
          type: "object",
          required: ["first_name", "last_name", "email", "password", "phone_number", "role"],
          properties: {
            first_name: { type: "string", example: "Priya" },
            last_name: { type: "string", example: "Mehta" },
            email: { type: "string", format: "email", example: "priya.mehta@nextonerealty.com" },
            password: { type: "string", minLength: 8, example: "TempPass@789" },
            phone_number: { type: "string", example: "+919123456789" },
            role: {
              type: "string",
              enum: [
                "super_admin",
                "admin",
                "sales_manager",
                "sales_executive",
                "external_caller"
              ],
              example: "sales_executive",
            },
            manager_id: {
              type: "string",
              format: "uuid",
              description: "Required when role is sales_executive",
              example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
            },
          },
        },
        PaginatedResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            data: { type: "array", items: { $ref: "#/components/schemas/User" } },
            pagination: {
              type: "object",
              properties: {
                total: { type: "integer" },
                page: { type: "integer" },
                per_page: { type: "integer" },
                total_pages: { type: "integer" },
              },
            },
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
            role: {
              type: "string",
              enum: [
                "super_admin",
                "admin",
                "sales_manager",
                "sales_executive",
                "external_caller"
              ],
            },
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
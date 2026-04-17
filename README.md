# Express PostgreSQL API

A production-ready REST API built with **Node.js**, **Express.js**, and **PostgreSQL**.

## Features
- **Auth**: Register, Login (email or phone), Auth Me, Forgot Password, Change Password
- **User Management**: Get All, Get By ID, Update (with language preferences & regions), Soft Delete
- **JWT Authentication** with role-based authorization
- **Swagger UI** docs at `/api-docs`
- **PostgreSQL** with parameterized queries
- Pagination, filtering & search on user list

## Roles
`superadmin` | `admin` | `sales_manager` | `sales_executive` | `external_caller`

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill environment variables
cp .env.example .env

# 3. Set up PostgreSQL database
psql -U your_user -d your_database -f db/schema.sql

# 4. Start development server
npm run dev
```

## Environment Variables
| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `DB_HOST` | PostgreSQL host |
| `DB_PORT` | PostgreSQL port (default: 5432) |
| `DB_NAME` | Database name |
| `DB_USER` | Database user |
| `DB_PASSWORD` | Database password |
| `JWT_SECRET` | JWT signing secret |
| `JWT_EXPIRES_IN` | Token expiry (e.g. `7d`) |

## API Endpoints

### Auth (`/api/v1/auth`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/register` | Register new user | No |
| POST | `/login` | Login (email or phone + password) | No |
| GET | `/me` | Get authenticated user | Yes |
| POST | `/forgot-password` | Request reset token | No |
| POST | `/change-password` | Change password with token | No |

### Users (`/api/v1/users`)
| Method | Endpoint | Description | Auth | Role |
|--------|----------|-------------|------|------|
| GET | `/` | Get all users | Yes | superadmin, admin |
| GET | `/:id` | Get user by ID | Yes | Any |
| PUT | `/:id` | Update user profile | Yes | Any |
| DELETE | `/:id` | Soft delete user | Yes | superadmin, admin |

## Swagger Docs
Visit `http://localhost:3000/api-docs` after starting the server.

## Project Structure
```
.
├── src/
│   ├── index.js              # App entry point
│   ├── config/
│   │   ├── db.js             # PostgreSQL pool config
│   │   └── swagger.js        # Swagger/OpenAPI config
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   └── user.controller.js
│   ├── middleware/
│   │   └── auth.js           # JWT authenticate + authorize
│   ├── routes/
│   │   ├── auth.routes.js
│   │   └── user.routes.js
│   └── utils/
│       └── response.js       # Standardized response helpers
└── db/
    ├── schema.sql            # Full DB schema (run this first)
    ├── auth/
    │   ├── register.sql
    │   ├── login.sql
    │   ├── auth_me.sql
    │   ├── forgot_password.sql
    │   └── change_password.sql
    └── users/
        ├── get_all_users.sql
        ├── get_user_by_id.sql
        ├── update_user.sql
        └── delete_user.sql
```

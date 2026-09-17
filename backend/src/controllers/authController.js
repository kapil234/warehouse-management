import bcrypt from "bcrypt";
import prisma from "../config/prisma.js";
import { signToken } from "../utils/jwt.js";

const SALT_ROUNDS = 10;
const ROLES = ["SUPER_ADMIN", "WAREHOUSE_MANAGER"];

// =====================================================
// Small internal helper — can `req.user` manage `targetUser`?
// Used by updateUser / deleteUser / getUserWarehouses so the
// same company-scoping rule lives in one place.
//
//   SUPER_ADMIN     -> can manage anyone
//   WAREHOUSE_MANAGER -> can only manage themself (e.g. change own password)
// =====================================================

function canManageUser(reqUser, targetUser) {
  if (reqUser.role === "SUPER_ADMIN") return true;
  if (reqUser.id === targetUser.id) return true;

  return false;
}

// =====================================================
// POST /api/auth/signup
// Public
//
// role: SUPER_ADMIN | WAREHOUSE_MANAGER
// companyId: required for WAREHOUSE_MANAGER
// warehouseAccess: optional, WAREHOUSE_MANAGER only —
//   [{ warehouseId, canInward, canOutward, canManageDocuments }]
//   Grants access to one or more warehouses in the same
//   transaction the user is created in.
// =====================================================

export async function signup(req, res) {
  try {
    const {
      name,
      email,
      password,
      role,
      companyId,
      warehouseAccess,
    } = req.body;

    // ---------------------------------------------
    // Basic validation
    // ---------------------------------------------

    if (!name || !name.trim()) {
      return res.status(400).json({
        message: "Full name is required",
      });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    if (!password) {
      return res.status(400).json({
        message: "Password is required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    if (!role || !ROLES.includes(role)) {
      return res.status(400).json({
        message: "Role must be one of: " + ROLES.join(", "),
      });
    }

    // ---------------------------------------------
    // Company requirement
    // WAREHOUSE_MANAGER accounts are scoped to a company.
    // ---------------------------------------------

    if (role !== "SUPER_ADMIN" && !companyId) {
      return res.status(400).json({
        message: "companyId is required for this role",
      });
    }

    let company = null;

    if (companyId) {
      company = await prisma.company.findUnique({
        where: { id: companyId },
      });

      if (!company) {
        return res.status(400).json({
          message: "companyId does not match an existing company",
        });
      }
    }

    // ---------------------------------------------
    // Check existing user
    // ---------------------------------------------

    const existingUser = await prisma.user.findUnique({
      where: {
        email: email.trim(),
      },
    });

    if (existingUser) {
      return res.status(409).json({
        message: "An account with this email already exists",
      });
    }

    // ---------------------------------------------
    // Validate warehouseAccess (WAREHOUSE_MANAGER only)
    // Every warehouse granted must belong to the same company.
    // ---------------------------------------------

    let accessRows = [];

    if (role === "WAREHOUSE_MANAGER" && Array.isArray(warehouseAccess)) {
      const warehouseIds = warehouseAccess
        .map((a) => a?.warehouseId)
        .filter(Boolean);

      if (warehouseIds.length) {
        const warehouses = await prisma.warehouse.findMany({
          where: { id: { in: warehouseIds } },
          select: { id: true, companyId: true },
        });

        const validIds = new Set(
          warehouses
            .filter((w) => w.companyId === companyId)
            .map((w) => w.id)
        );

        if (validIds.size !== warehouseIds.length) {
          return res.status(400).json({
            message:
              "One or more warehouses do not exist or don't belong to this company",
          });
        }

        accessRows = warehouseAccess.map((a) => ({
          warehouseId: a.warehouseId,
          accessLevel: "MANAGE",
          canInward: Boolean(a.canInward),
          canOutward: Boolean(a.canOutward),
          canManageDocuments: Boolean(a.canManageDocuments),
        }));
      }
    }

    // ---------------------------------------------
    // Hash password
    // ---------------------------------------------

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // ---------------------------------------------
    // Create user (+ warehouse access rows) atomically
    // ---------------------------------------------

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.trim(),
        passwordHash,
        role,
        companyId: companyId || null,
        warehouseAccess: accessRows.length
          ? { create: accessRows }
          : undefined,
      },

      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        warehouseAccess: {
          select: {
            warehouseId: true,
            accessLevel: true,
            canInward: true,
            canOutward: true,
            canManageDocuments: true,
          },
        },
      },
    });

    // ---------------------------------------------
    // Create JWT
    // ---------------------------------------------

    const token = signToken({
      userId: user.id,
      role: user.role,
    });

    // ---------------------------------------------
    // Response
    // ---------------------------------------------

    return res.status(201).json({
      message: "Account created successfully",
      token,
      user,
    });
  } catch (error) {
    console.error("Signup error:", error);

    return res.status(500).json({
      message: "Something went wrong while creating the account",
    });
  }
}

// =====================================================
// POST /api/auth/login
// Public
// =====================================================

export async function login(req, res) {
  try {
    const { email, password } = req.body;

    // ---------------------------------------------
    // Basic validation
    // ---------------------------------------------

    if (!email || !email.trim()) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    if (!password) {
      return res.status(400).json({
        message: "Password is required",
      });
    }

    // ---------------------------------------------
    // Find user
    // ---------------------------------------------

    const user = await prisma.user.findUnique({
      where: {
        email: email.trim(),
      },

      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        passwordHash: true,
        warehouseAccess: {
          select: {
            warehouseId: true,
            accessLevel: true,
            canInward: true,
            canOutward: true,
            canManageDocuments: true,
          },
        },
      },
    });

    // ---------------------------------------------
    // Invalid user
    // ---------------------------------------------

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // ---------------------------------------------
    // Compare password
    // ---------------------------------------------

    const passwordMatches = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // ---------------------------------------------
    // Create JWT
    // ---------------------------------------------

    const token = signToken({
      userId: user.id,
      role: user.role,
    });

    // ---------------------------------------------
    // Response
    // Warehouse managers get their access list back so the
    // frontend knows which warehouses to show without an extra call.
    // ---------------------------------------------

    return res.json({
      token,

      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
        warehouseAccess:
          user.role === "WAREHOUSE_MANAGER" ? user.warehouseAccess : undefined,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "Something went wrong while logging in",
    });
  }
}

// =====================================================
// GET /api/auth/me
// Protected
// =====================================================

export async function me(req, res) {
  try {
    return res.json({
      user: req.user,
    });
  } catch (error) {
    console.error("Get current user error:", error);

    return res.status(500).json({
      message: "Something went wrong",
    });
  }
}

// =====================================================
// PATCH /api/users/:id/role
// Protected + SUPER_ADMIN
//
// If the new role isn't SUPER_ADMIN, the user must end up with
// a companyId — either one they already have, or one passed in
// the same request body.
// =====================================================

export async function updateUserRole(req, res) {
  try {
    const { role, companyId } = req.body;

    // ---------------------------------------------
    // Validate role
    // ---------------------------------------------

    if (!role || !ROLES.includes(role)) {
      return res.status(400).json({
        message: "Role must be one of: " + ROLES.join(", "),
      });
    }

    // ---------------------------------------------
    // Find target user
    // ---------------------------------------------

    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!targetUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!canManageUser(req.user, targetUser)) {
      return res.status(403).json({
        message: "You don't have permission to manage this user",
      });
    }

    const resolvedCompanyId = companyId || targetUser.companyId;

    if (role !== "SUPER_ADMIN" && !resolvedCompanyId) {
      return res.status(400).json({
        message: "companyId is required for this role",
      });
    }

    // ---------------------------------------------
    // Update role (+ companyId if it changed)
    // ---------------------------------------------

    const updatedUser = await prisma.user.update({
      where: { id: req.params.id },

      data: {
        role,
        companyId: role === "SUPER_ADMIN" ? null : resolvedCompanyId,
      },

      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
      },
    });

    // ---------------------------------------------
    // Response
    // ---------------------------------------------

    return res.json({
      message: "User role updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Update role error:", error);

    return res.status(500).json({
      message: "Something went wrong while updating the role",
    });
  }
}

// =====================================================
// PATCH /api/users/:id
// Protected + SUPER_ADMIN (or self)
//
// General profile update: name, email, and an optional
// password change. Role and companyId changes go through
// updateUserRole instead — keeps that sensitive path separate.
// Warehouse access is managed via the warehouse access endpoints,
// not here (it's a list of relations, not a scalar field).
// =====================================================

export async function updateUser(req, res) {
  try {
    const { name, email, password } = req.body;

    // ---------------------------------------------
    // Find target user
    // ---------------------------------------------

    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!targetUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!canManageUser(req.user, targetUser)) {
      return res.status(403).json({
        message: "You don't have permission to manage this user",
      });
    }

    // ---------------------------------------------
    // Validate email + uniqueness (if provided)
    // ---------------------------------------------

    if (email !== undefined) {
      if (!email.trim()) {
        return res.status(400).json({
          message: "Email is required",
        });
      }

      const existingUser = await prisma.user.findUnique({
        where: { email: email.trim() },
      });

      if (existingUser && existingUser.id !== targetUser.id) {
        return res.status(409).json({
          message: "Another account with this email already exists",
        });
      }
    }

    // ---------------------------------------------
    // Validate name (if provided)
    // ---------------------------------------------

    if (name !== undefined && !name.trim()) {
      return res.status(400).json({
        message: "Full name is required",
      });
    }

    // ---------------------------------------------
    // Validate + hash password (if provided)
    // ---------------------------------------------

    let passwordHash;

    if (password !== undefined && password !== "") {
      if (password.length < 8) {
        return res.status(400).json({
          message: "Password must be at least 8 characters",
        });
      }

      passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    }

    // ---------------------------------------------
    // Build update payload
    // ---------------------------------------------

    const data = {};

    if (name !== undefined) data.name = name.trim();
    if (email !== undefined) data.email = email.trim();
    if (passwordHash !== undefined) data.passwordHash = passwordHash;

    // ---------------------------------------------
    // Update user
    // ---------------------------------------------

    const updatedUser = await prisma.user.update({
      where: { id: req.params.id },

      data,

      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        createdAt: true,
      },
    });

    // ---------------------------------------------
    // Response
    // ---------------------------------------------

    return res.json({
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Update user error:", error);

    return res.status(500).json({
      message: "Something went wrong while updating the user",
    });
  }
}

// =====================================================
// GET /api/users?companyId=
// Protected + SUPER_ADMIN
//
// SUPER_ADMIN sees everyone (optionally filtered by ?companyId=).
// Users are not scoped through a company-admin role.
// of what's in the query string.
// =====================================================

export async function listUsers(req, res) {
  try {
    const where = {};

    if (req.query.companyId) {
      where.companyId = req.query.companyId;
    }

    const users = await prisma.user.findMany({
      where,

      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        createdAt: true,
        company: {
          select: { id: true, name: true, code: true },
        },
        warehouseAccess: {
          select: {
            warehouseId: true,
            accessLevel: true,
            canInward: true,
            canOutward: true,
            canManageDocuments: true,
            warehouse: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },

      orderBy: { createdAt: "desc" },
    });

    return res.json({ data: users });
  } catch (error) {
    console.error("List users error:", error);

    return res.status(500).json({
      message: "Something went wrong while fetching users",
    });
  }
}

// =====================================================
// GET /api/users/:id/warehouses
// Protected — self, or SUPER_ADMIN of that user
//
// Every warehouse this user currently has access to, with the
// specific permissions granted on each one.
// =====================================================

export async function getUserWarehouses(req, res) {
  try {
    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!targetUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!canManageUser(req.user, targetUser)) {
      return res.status(403).json({
        message: "You don't have permission to view this user's access",
      });
    }

    const access = await prisma.warehouseAccess.findMany({
      where: { userId: req.params.id },

      select: {
        accessLevel: true,
        canInward: true,
        canOutward: true,
        canManageDocuments: true,
        grantedAt: true,
        warehouse: {
          select: {
            id: true,
            name: true,
            code: true,
            city: true,
            state: true,
          },
        },
      },
    });

    return res.json({ data: access });
  } catch (error) {
    console.error("Get user warehouses error:", error);

    return res.status(500).json({
      message: "Something went wrong while fetching the user's warehouses",
    });
  }
}

// =====================================================
// DELETE /api/users/:id
// Protected + SUPER_ADMIN
// =====================================================

export async function deleteUser(req, res) {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({
        message: "You can't delete your own account",
      });
    }

    // ---------------------------------------------
    // Find user
    // ---------------------------------------------

    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!canManageUser(req.user, user)) {
      return res.status(403).json({
        message: "You don't have permission to delete this user",
      });
    }

    // ---------------------------------------------
    // Delete user
    // WarehouseAccess rows cascade automatically (onDelete: Cascade).
    // ---------------------------------------------

    await prisma.user.delete({
      where: { id: req.params.id },
    });

    // ---------------------------------------------
    // Response
    // ---------------------------------------------

    return res.json({
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Delete user error:", error);

    return res.status(500).json({
      message: "Something went wrong while deleting the user",
    });
  }
}

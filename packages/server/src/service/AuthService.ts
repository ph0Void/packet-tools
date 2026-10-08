import { prismaClient } from "@/prisma/lib/PrismaClient";
import { BcryptAdapter } from "@/utils/BcryptAdapter";
import { JwtAdapter } from "@/utils/JwtAdapter";
import { Logger } from "@/utils/Logger";

export async function loginAuthService(username: string, password: string) {
  const user = await prismaClient.user.findUnique({
    where: { username },
  });

  if (!user) {
    return { success: false, message: "Usuario o contraseña inválidos" };
  }

  const isPasswordValid = BcryptAdapter.compare(password, user.password);
  if (!isPasswordValid) {
    return { success: false, message: "Usuario o contraseña inválidos" };
  }

  const tokenPayload = {
    id: user.id,
    username: user.username,
    role: user.role,
  };
  const token = JwtAdapter.generateToken(tokenPayload);

  await prismaClient.user.update({
    where: { id: user.id },
    data: { token },
  });

  return {
    success: true,
    message: "Inicio de sesión exitoso",
    data: token,
  };
}

export async function registerAuthService(username: string, password: string) {
  const userExist = await prismaClient.user.findUnique({
    where: { username },
  });

  if (userExist) {
    return { success: false, message: `Usuario ${username} ya existe` };
  }

  const hashedPassword = BcryptAdapter.hash(password);
  const newUser = await prismaClient.user.create({
    data: {
      username,
      password: hashedPassword,
      role: "USER",
    },
  });

  Logger.info({
    message: `[AUTH_SERVICE] Usuario creado exitosamente`,
    data: {
      username: newUser.username,
      date: newUser.createdAt,
    },
  });

  return {
    success: true,
    message: "Usuario registrado exitosamente",
    data: newUser,
  };
}

export async function getUserByToken(token: string) {
  try {
    const isValid = JwtAdapter.isValidToken(token);
    if (!isValid) {
      return {
        success: false,
        message: "Token inválido o expirado",
        data: null,
      };
    }

    const user = await prismaClient.user.findUnique({
      where: { token: token },
    });
    if (!user) {
      return {
        success: false,
        message: "Token no asociado a ningún usuario",
        data: null,
      };
    }

    return {
      success: true,
      message: " Usuario autenticado",
      data: user,
    };
  } catch (error) {
    return {
      success: false,
      message: "El token es inválido o ha expirado para el usuario",
      data: null,
    };
  }
}

export async function validateAuthToken(token: string) {
  try {
    const isValid = JwtAdapter.isValidToken(token);
    if (!isValid) {
      return {
        success: false,
        message: "Token inválido o expirado",
      };
    }

    const user = await prismaClient.user.findUnique({
      where: { token: token },
    });
    if (!user) {
      return {
        success: false,
        message: "Token no asociado a ningún usuario",
      };
    }

    return {
      success: true,
      message: "Token válido",
    };
  } catch (error) {
    console.error("Error en validateAuthToken:", error);
    return {
      success: false,
      message: "Error al validar el token",
    };
  }
}

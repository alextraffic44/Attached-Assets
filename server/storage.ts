import { db } from "./db";
import { users, projects, projectMessages, projectImages, projectVersions, projectFiles, leads, creditTransactions, paymentOrders, adVideos, type User, type InsertUser, type Project, type InsertProject, type ProjectMessage, type InsertProjectMessage, type ProjectImage, type InsertProjectImage, type ProjectVersion, type InsertProjectVersion, type ProjectFile, type InsertProjectFile, type Lead, type InsertLead, type CreditTransaction, type PaymentOrder, type AdVideo, type InsertAdVideo } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByTelegramId(telegramId: string): Promise<User | undefined>;
  getUserByYandexId(yandexId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createTelegramUser(data: { telegramId: string; displayName: string; avatarUrl?: string }): Promise<User>;
  createYandexUser(data: { yandexId: string; displayName: string; email?: string; avatarUrl?: string }): Promise<User>;
  updateUserCredits(id: number, credits: number): Promise<User | undefined>;
  deductCredits(userId: number, amount: number, operation: string, idempotencyKey: string): Promise<{ success: boolean; newBalance: number; alreadyProcessed?: boolean }>;
  refundCredits(userId: number, amount: number): Promise<number>;

  getProject(id: number): Promise<Project | undefined>;
  getProjectsByUser(userId: number): Promise<Project[]>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: number, data: Partial<Project>): Promise<Project | undefined>;
  deleteProject(id: number): Promise<void>;

  getProjectMessages(projectId: number): Promise<ProjectMessage[]>;
  createProjectMessage(message: InsertProjectMessage): Promise<ProjectMessage>;

  getProjectImages(projectId: number): Promise<ProjectImage[]>;
  getImagesByUser(userId: number): Promise<(ProjectImage & { projectTitle: string })[]>;
  createProjectImage(image: InsertProjectImage): Promise<ProjectImage>;
  deleteProjectImage(id: number): Promise<void>;

  getProjectVersions(projectId: number): Promise<ProjectVersion[]>;
  createProjectVersion(version: InsertProjectVersion): Promise<ProjectVersion>;

  getProjectFiles(projectId: number): Promise<ProjectFile[]>;
  getProjectFile(projectId: number, filename: string): Promise<ProjectFile | undefined>;
  upsertProjectFile(file: InsertProjectFile): Promise<ProjectFile>;
  deleteProjectFile(id: number): Promise<void>;
  deleteProjectFilesByProject(projectId: number): Promise<void>;

  getLeadsByProject(projectId: number): Promise<Lead[]>;
  getLeadsByUser(userId: number): Promise<(Lead & { projectTitle: string })[]>;
  createLead(lead: InsertLead): Promise<Lead>;
  markLeadRead(id: number): Promise<Lead | undefined>;
  deleteLead(id: number): Promise<void>;
  getUnreadLeadCount(userId: number): Promise<number>;

  getPublishedProjectsCount(userId: number): Promise<number>;
  getAllPublishedProjects(): Promise<Project[]>;
  getAllUsersWithPublishedSites(): Promise<{ userId: number; publishedCount: number }[]>;

  adminGetAllUsers(): Promise<User[]>;
  adminGetUserTransactions(userId: number): Promise<import("@shared/schema").CreditTransaction[]>;
  adminAdjustCredits(userId: number, amount: number, type: "credit" | "debit", operation: string, note: string): Promise<User | undefined>;
  adminGetUserProjects(userId: number): Promise<Project[]>;
  adminGetStats(): Promise<{ totalUsers: number; totalProjects: number; totalTokensSpent: number; totalTokensAdded: number }>;

  createPaymentOrder(data: { userId: number; amount: number; tokens: number; orderId?: string; paymentUrl?: string }): Promise<PaymentOrder>;
  getPaymentOrderById(id: number): Promise<PaymentOrder | undefined>;
  getPaymentOrderByOrderId(orderId: string): Promise<PaymentOrder | undefined>;
  updatePaymentOrderStatus(id: number, status: string, orderId?: string, paidAt?: Date): Promise<PaymentOrder | undefined>;
  getPaymentOrdersByUser(userId: number): Promise<PaymentOrder[]>;

  createAdVideo(data: InsertAdVideo): Promise<AdVideo>;
  getAdVideo(id: number): Promise<AdVideo | undefined>;
  updateAdVideo(id: number, data: Partial<AdVideo>): Promise<AdVideo | undefined>;
  getAdVideosByUser(userId: number): Promise<AdVideo[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByTelegramId(telegramId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async createTelegramUser(data: { telegramId: string; displayName: string; avatarUrl?: string }): Promise<User> {
    const [user] = await db.insert(users).values({
      displayName: data.displayName,
      telegramId: data.telegramId,
      avatarUrl: data.avatarUrl ?? null,
    }).returning();
    return user;
  }

  async getUserByYandexId(yandexId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.yandexId, yandexId));
    return user;
  }

  async createYandexUser(data: { yandexId: string; displayName: string; email?: string; avatarUrl?: string }): Promise<User> {
    const [user] = await db.insert(users).values({
      displayName: data.displayName,
      yandexId: data.yandexId,
      email: data.email ?? null,
      avatarUrl: data.avatarUrl ?? null,
    }).returning();
    return user;
  }

  async updateUserCredits(id: number, credits: number): Promise<User | undefined> {
    const [user] = await db.update(users).set({ credits }).where(eq(users.id, id)).returning();
    return user;
  }

  async deductCredits(userId: number, amount: number, operation: string, idempotencyKey: string): Promise<{ success: boolean; newBalance: number; alreadyProcessed?: boolean }> {
    const existing = await db.select().from(creditTransactions).where(eq(creditTransactions.idempotencyKey, idempotencyKey));
    if (existing.length > 0) {
      const user = await this.getUser(userId);
      return { success: true, newBalance: user?.credits ?? 0, alreadyProcessed: true };
    }

    const result = await db.execute(
      sql`UPDATE users SET credits = credits - ${amount} WHERE id = ${userId} AND credits >= ${amount} RETURNING credits`
    );
    const rows = result.rows as Array<{ credits: number }>;
    if (!rows || rows.length === 0) {
      const user = await this.getUser(userId);
      return { success: false, newBalance: user?.credits ?? 0 };
    }

    await db.insert(creditTransactions).values({
      userId,
      amount,
      operation,
      idempotencyKey,
    });

    return { success: true, newBalance: rows[0].credits };
  }

  async refundCredits(userId: number, amount: number): Promise<number> {
    const result = await db.execute(
      sql`UPDATE users SET credits = credits + ${amount} WHERE id = ${userId} RETURNING credits`
    );
    const rows = result.rows as Array<{ credits: number }>;
    return rows?.[0]?.credits ?? 0;
  }

  async getProject(id: number): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async getProjectsByUser(userId: number): Promise<Project[]> {
    return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.createdAt));
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const [project] = await db.insert(projects).values(insertProject).returning();
    return project;
  }

  async updateProject(id: number, data: Partial<Project>): Promise<Project | undefined> {
    const [project] = await db.update(projects).set({ ...data, updatedAt: new Date() }).where(eq(projects.id, id)).returning();
    return project;
  }

  async deleteProject(id: number): Promise<void> {
    await db.delete(projectMessages).where(eq(projectMessages.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }

  async getProjectMessages(projectId: number): Promise<ProjectMessage[]> {
    return db.select().from(projectMessages).where(eq(projectMessages.projectId, projectId)).orderBy(projectMessages.createdAt);
  }

  async createProjectMessage(message: InsertProjectMessage): Promise<ProjectMessage> {
    const [msg] = await db.insert(projectMessages).values(message).returning();
    return msg;
  }

  async getProjectImages(projectId: number): Promise<ProjectImage[]> {
    return db.select().from(projectImages).where(eq(projectImages.projectId, projectId)).orderBy(desc(projectImages.createdAt));
  }

  async getImagesByUser(userId: number): Promise<(ProjectImage & { projectTitle: string })[]> {
    const rows = await db
      .select({
        id: projectImages.id,
        projectId: projectImages.projectId,
        userId: projectImages.userId,
        name: projectImages.name,
        url: projectImages.url,
        prompt: projectImages.prompt,
        createdAt: projectImages.createdAt,
        projectTitle: sql<string>`COALESCE(${projects.title}, 'Удалённый проект')`,
      })
      .from(projectImages)
      .leftJoin(projects, eq(projectImages.projectId, projects.id))
      .where(
        sql`(${projects.userId} = ${userId} OR ${projectImages.userId} = ${userId})`
      )
      .orderBy(desc(projectImages.createdAt));
    return rows;
  }

  async createProjectImage(image: InsertProjectImage): Promise<ProjectImage> {
    const [img] = await db.insert(projectImages).values(image).returning();
    return img;
  }

  async deleteProjectImage(id: number): Promise<void> {
    await db.delete(projectImages).where(eq(projectImages.id, id));
  }

  async getProjectVersions(projectId: number): Promise<ProjectVersion[]> {
    return db.select().from(projectVersions).where(eq(projectVersions.projectId, projectId)).orderBy(desc(projectVersions.createdAt));
  }

  async createProjectVersion(version: InsertProjectVersion): Promise<ProjectVersion> {
    const [v] = await db.insert(projectVersions).values(version).returning();
    return v;
  }

  async getProjectFiles(projectId: number): Promise<ProjectFile[]> {
    return db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId)).orderBy(projectFiles.filename);
  }

  async getProjectFile(projectId: number, filename: string): Promise<ProjectFile | undefined> {
    const [file] = await db.select().from(projectFiles).where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.filename, filename)));
    return file;
  }

  async upsertProjectFile(file: InsertProjectFile): Promise<ProjectFile> {
    const existing = await this.getProjectFile(file.projectId, file.filename);
    if (existing) {
      const [updated] = await db.update(projectFiles).set({ code: file.code }).where(eq(projectFiles.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(projectFiles).values(file).returning();
    return created;
  }

  async deleteProjectFile(id: number): Promise<void> {
    await db.delete(projectFiles).where(eq(projectFiles.id, id));
  }

  async deleteProjectFilesByProject(projectId: number): Promise<void> {
    await db.delete(projectFiles).where(eq(projectFiles.projectId, projectId));
  }

  async getLeadsByProject(projectId: number): Promise<Lead[]> {
    return db.select().from(leads).where(eq(leads.projectId, projectId)).orderBy(desc(leads.createdAt));
  }

  async getLeadsByUser(userId: number): Promise<(Lead & { projectTitle: string })[]> {
    const userProjects = await db.select().from(projects).where(eq(projects.userId, userId));
    const projectIds = userProjects.map(p => p.id);
    if (projectIds.length === 0) return [];
    const allLeads: (Lead & { projectTitle: string })[] = [];
    for (const proj of userProjects) {
      const projLeads = await db.select().from(leads).where(eq(leads.projectId, proj.id)).orderBy(desc(leads.createdAt));
      for (const l of projLeads) {
        allLeads.push({ ...l, projectTitle: proj.title });
      }
    }
    allLeads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return allLeads;
  }

  async createLead(lead: InsertLead): Promise<Lead> {
    const [l] = await db.insert(leads).values(lead).returning();
    return l;
  }

  async markLeadRead(id: number): Promise<Lead | undefined> {
    const [l] = await db.update(leads).set({ isRead: 1 }).where(eq(leads.id, id)).returning();
    return l;
  }

  async deleteLead(id: number): Promise<void> {
    await db.delete(leads).where(eq(leads.id, id));
  }

  async getUnreadLeadCount(userId: number): Promise<number> {
    const userProjects = await db.select().from(projects).where(eq(projects.userId, userId));
    let count = 0;
    for (const proj of userProjects) {
      const projLeads = await db.select().from(leads).where(eq(leads.projectId, proj.id));
      count += projLeads.filter(l => l.isRead === 0).length;
    }
    return count;
  }

  async getPublishedProjectsCount(userId: number): Promise<number> {
    const result = await db.select().from(projects).where(and(eq(projects.userId, userId), eq(projects.publishStatus, "published")));
    return result.length;
  }

  async getAllPublishedProjects(): Promise<Project[]> {
    return db.select().from(projects).where(eq(projects.publishStatus, "published"));
  }

  async getAllUsersWithPublishedSites(): Promise<{ userId: number; publishedCount: number }[]> {
    const published = await db.select().from(projects).where(eq(projects.publishStatus, "published"));
    const map = new Map<number, number>();
    for (const p of published) {
      map.set(p.userId, (map.get(p.userId) || 0) + 1);
    }
    return Array.from(map.entries()).map(([userId, publishedCount]) => ({ userId, publishedCount }));
  }

  async adminGetAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async adminGetUserTransactions(userId: number): Promise<CreditTransaction[]> {
    return db.select().from(creditTransactions).where(eq(creditTransactions.userId, userId)).orderBy(desc(creditTransactions.createdAt));
  }

  async adminAdjustCredits(userId: number, amount: number, type: "credit" | "debit", operation: string, note: string): Promise<User | undefined> {
    const idempotencyKey = `admin-${type}-${userId}-${Date.now()}-${Math.random()}`;
    if (type === "credit") {
      const result = await db.execute(sql`UPDATE users SET credits = credits + ${amount} WHERE id = ${userId} RETURNING credits`);
      const rows = result.rows as Array<{ credits: number }>;
      await db.insert(creditTransactions).values({ userId, amount, type: "credit", operation, note, idempotencyKey });
      return this.getUser(userId);
    } else {
      await db.execute(sql`UPDATE users SET credits = GREATEST(0, credits - ${amount}) WHERE id = ${userId}`);
      await db.insert(creditTransactions).values({ userId, amount, type: "debit", operation, note, idempotencyKey });
      return this.getUser(userId);
    }
  }

  async adminGetUserProjects(userId: number): Promise<Project[]> {
    return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.createdAt));
  }

  async adminGetStats(): Promise<{ totalUsers: number; totalProjects: number; totalTokensSpent: number; totalTokensAdded: number }> {
    const r1 = await db.execute(sql`SELECT COUNT(*)::int as count FROM users`);
    const r2 = await db.execute(sql`SELECT COUNT(*)::int as count FROM projects`);
    const r3 = await db.execute(sql`SELECT COALESCE(SUM(amount),0)::int as total FROM credit_transactions WHERE type='debit' OR type IS NULL`);
    const r4 = await db.execute(sql`SELECT COALESCE(SUM(amount),0)::int as total FROM credit_transactions WHERE type='credit'`);
    return {
      totalUsers: Number((r1.rows[0] as any)?.count ?? 0),
      totalProjects: Number((r2.rows[0] as any)?.count ?? 0),
      totalTokensSpent: Number((r3.rows[0] as any)?.total ?? 0),
      totalTokensAdded: Number((r4.rows[0] as any)?.total ?? 0),
    };
  }

  async createPaymentOrder(data: { userId: number; amount: number; tokens: number; orderId?: string; paymentUrl?: string }): Promise<PaymentOrder> {
    const [order] = await db.insert(paymentOrders).values(data).returning();
    return order;
  }

  async getPaymentOrderById(id: number): Promise<PaymentOrder | undefined> {
    const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.id, id));
    return order;
  }

  async getPaymentOrderByOrderId(orderId: string): Promise<PaymentOrder | undefined> {
    const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.orderId, orderId));
    return order;
  }

  async updatePaymentOrderStatus(id: number, status: string, orderId?: string, paidAt?: Date): Promise<PaymentOrder | undefined> {
    const updates: any = { status };
    if (orderId) updates.orderId = orderId;
    if (paidAt) updates.paidAt = paidAt;
    const [order] = await db.update(paymentOrders).set(updates).where(eq(paymentOrders.id, id)).returning();
    return order;
  }

  async getPaymentOrdersByUser(userId: number): Promise<PaymentOrder[]> {
    return db.select().from(paymentOrders).where(eq(paymentOrders.userId, userId)).orderBy(desc(paymentOrders.createdAt));
  }

  async createAdVideo(data: InsertAdVideo): Promise<AdVideo> {
    const [video] = await db.insert(adVideos).values(data).returning();
    return video;
  }

  async getAdVideo(id: number): Promise<AdVideo | undefined> {
    const [video] = await db.select().from(adVideos).where(eq(adVideos.id, id));
    return video;
  }

  async updateAdVideo(id: number, data: Partial<AdVideo>): Promise<AdVideo | undefined> {
    const [video] = await db.update(adVideos).set(data).where(eq(adVideos.id, id)).returning();
    return video;
  }

  async getAdVideosByUser(userId: number): Promise<AdVideo[]> {
    return db.select().from(adVideos).where(eq(adVideos.userId, userId)).orderBy(desc(adVideos.createdAt));
  }
}

export const storage = new DatabaseStorage();

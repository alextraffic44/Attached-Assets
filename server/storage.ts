import { db } from "./db";
import { users, projects, projectMessages, projectImages, projectVersions, projectFiles, leads, type User, type InsertUser, type Project, type InsertProject, type ProjectMessage, type InsertProjectMessage, type ProjectImage, type InsertProjectImage, type ProjectVersion, type InsertProjectVersion, type ProjectFile, type InsertProjectFile, type Lead, type InsertLead } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserCredits(id: number, credits: number): Promise<User | undefined>;

  getProject(id: number): Promise<Project | undefined>;
  getProjectsByUser(userId: number): Promise<Project[]>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: number, data: Partial<Project>): Promise<Project | undefined>;
  deleteProject(id: number): Promise<void>;

  getProjectMessages(projectId: number): Promise<ProjectMessage[]>;
  createProjectMessage(message: InsertProjectMessage): Promise<ProjectMessage>;

  getProjectImages(projectId: number): Promise<ProjectImage[]>;
  createProjectImage(image: InsertProjectImage): Promise<ProjectImage>;
  deleteProjectImage(id: number): Promise<void>;

  getProjectVersions(projectId: number): Promise<ProjectVersion[]>;
  createProjectVersion(version: InsertProjectVersion): Promise<ProjectVersion>;

  getProjectFiles(projectId: number): Promise<ProjectFile[]>;
  getProjectFile(projectId: number, filename: string): Promise<ProjectFile | undefined>;
  upsertProjectFile(file: InsertProjectFile): Promise<ProjectFile>;
  deleteProjectFile(id: number): Promise<void>;

  getLeadsByProject(projectId: number): Promise<Lead[]>;
  getLeadsByUser(userId: number): Promise<(Lead & { projectTitle: string })[]>;
  createLead(lead: InsertLead): Promise<Lead>;
  markLeadRead(id: number): Promise<Lead | undefined>;
  deleteLead(id: number): Promise<void>;
  getUnreadLeadCount(userId: number): Promise<number>;
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

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserCredits(id: number, credits: number): Promise<User | undefined> {
    const [user] = await db.update(users).set({ credits }).where(eq(users.id, id)).returning();
    return user;
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
}

export const storage = new DatabaseStorage();

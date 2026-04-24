import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useAuth } from "@/context/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Project } from "@shared/schema";
import {
  Plus, FolderOpen, Globe, Calendar, Trash2, ArrowRight, ExternalLink, Clock, Sparkles,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const G = "#0DFF82";

const createProjectSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  url: z.string().url("Must be a valid URL (e.g. https://example.com)").optional().or(z.literal("")),
  description: z.string().optional(),
});

type CreateProjectData = z.infer<typeof createProjectSchema>;

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function ProjectCard({
  project,
  onDelete,
}: {
  project: Project;
  onDelete: (id: number) => void;
}) {
  return (
    <div
      className="group rounded-xl p-5 transition-all duration-200 cursor-pointer relative overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
      data-testid={`card-project-${project.id}`}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
        (e.currentTarget as HTMLElement).style.borderColor = "rgba(13,255,130,0.2)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
        (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)";
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${G}14` }}
          >
            <FolderOpen className="w-4 h-4" style={{ color: G }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3
                className="font-semibold text-sm text-white truncate"
                data-testid={`text-project-name-${project.id}`}
              >
                {project.name}
              </h3>
              {project.isDemo && (
                <span
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: "rgba(13,255,130,0.1)", color: G, border: "1px solid rgba(13,255,130,0.25)" }}
                  data-testid={`badge-demo-${project.id}`}
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  Demo
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(project.id);
          }}
          data-testid={`button-delete-project-${project.id}`}
          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 flex-shrink-0"
          style={{ color: "rgba(255,255,255,0.3)" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(255,41,71,0.12)";
            (e.currentTarget as HTMLElement).style.color = "#FF2947";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.3)";
          }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {project.description && (
        <p
          className="text-xs mb-3 line-clamp-2"
          style={{ color: "rgba(255,255,255,0.4)" }}
          data-testid={`text-project-description-${project.id}`}
        >
          {project.description}
        </p>
      )}

      {project.url && (
        <div className="flex items-center gap-1.5 mb-3" data-testid={`text-project-url-${project.id}`}>
          <Globe className="w-3 h-3 flex-shrink-0" style={{ color: "rgba(255,255,255,0.25)" }} />
          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs truncate hover:underline"
            style={{ color: "rgba(255,255,255,0.35)" }}
          >
            {project.url.replace(/^https?:\/\//, "")}
          </a>
          <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3 h-3" style={{ color: "rgba(255,255,255,0.2)" }} />
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
              {formatDate(project.createdAt.toString())}
            </span>
          </div>
          {project.monitoringSchedule && project.monitoringSchedule !== "off" && (
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded-full"
              style={{ background: project.monitoringPaused ? "rgba(255,184,0,0.1)" : `${G}10`, border: `1px solid ${project.monitoringPaused ? "rgba(255,184,0,0.2)" : `${G}25`}` }}
              data-testid={`badge-monitoring-${project.id}`}
            >
              <Clock className="w-2.5 h-2.5" style={{ color: project.monitoringPaused ? "#FFB800" : G }} />
              <span className="text-xs font-medium" style={{ color: project.monitoringPaused ? "#FFB800" : G }}>
                {project.monitoringPaused ? "Paused" : project.monitoringSchedule === "hourly" ? "Hourly" : "Daily"}
              </span>
            </div>
          )}
        </div>
        <Link href={`/dashboard/projects/${project.id}`} data-testid={`link-project-${project.id}`}>
          <span
            className="text-xs font-medium flex items-center gap-1"
            style={{ color: G }}
          >
            Open <ArrowRight className="w-3 h-3" />
          </span>
        </Link>
      </div>
    </div>
  );
}

function CreateProjectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();

  const form = useForm<CreateProjectData>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: "", url: "", description: "" },
  });

  const mutation = useMutation({
    mutationFn: async (data: CreateProjectData) => {
      const payload = {
        name: data.name,
        description: data.description || undefined,
        url: data.url || undefined,
      };
      const res = await apiRequest("POST", "/api/projects", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project created", description: "Your project has been created." });
      form.reset();
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create project", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        style={{ background: "#0E0E0E", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <DialogHeader>
          <DialogTitle className="text-white">New Project</DialogTitle>
          <DialogDescription style={{ color: "rgba(255,255,255,0.4)" }}>
            Add an app or website you want to generate tests for.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4 mt-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>
                    Project name
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="My App"
                      data-testid="input-project-name"
                      className="bg-transparent border-white/10 text-white placeholder:text-white/20 focus:border-[#0DFF82] focus:ring-0"
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>
                    URL <span style={{ color: "rgba(255,255,255,0.25)" }}>(optional)</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="https://example.com"
                      data-testid="input-project-url"
                      className="bg-transparent border-white/10 text-white placeholder:text-white/20 focus:border-[#0DFF82] focus:ring-0"
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>
                    Description{" "}
                    <span style={{ color: "rgba(255,255,255,0.25)" }}>(optional)</span>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="A brief description of your app..."
                      data-testid="input-project-description"
                      rows={3}
                      className="bg-transparent border-white/10 text-white placeholder:text-white/20 focus:border-[#0DFF82] focus:ring-0 resize-none"
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                data-testid="button-cancel-create"
                className="flex-1 border-white/10 bg-transparent text-white/60 hover:text-white hover:bg-white/5"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending}
                data-testid="button-create-project"
                className="flex-1 font-bold text-black"
                style={{ background: G, border: "none" }}
              >
                {mutation.isPending ? (
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : (
                  "Create Project"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: projects, isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project deleted" });
      setDeleteId(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete project", variant: "destructive" });
    },
  });

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <DashboardLayout>
      <div className="p-8">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: G }}>
              {greeting()},
            </p>
            <h1 className="text-3xl font-black text-white">
              {user?.name?.split(" ")[0] ?? "there"}.
            </h1>
            <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
              Manage your projects and generate AI-powered tests.
            </p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            data-testid="button-new-project"
            className="font-bold gap-2 text-black"
            style={{ background: G, border: "none" }}
          >
            <Plus className="w-4 h-4" />
            New Project
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-xl p-5 animate-pulse"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", height: 160 }}
              />
            ))}
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="list-projects">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} onDelete={setDeleteId} />
            ))}
          </div>
        ) : (
          <div
            className="rounded-xl p-12 text-center"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
            data-testid="text-no-projects"
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4"
              style={{ background: `${G}14` }}
            >
              <FolderOpen className="w-6 h-6" style={{ color: G }} />
            </div>
            <h2 className="text-white font-bold text-lg mb-2">No projects yet</h2>
            <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.35)" }}>
              Create your first project to start generating AI-powered tests.
            </p>
            <Button
              onClick={() => setCreateOpen(true)}
              data-testid="button-create-first"
              className="font-bold gap-2 text-black"
              style={{ background: G, border: "none" }}
            >
              <Plus className="w-4 h-4" />
              Create Project
            </Button>
          </div>
        )}
      </div>

      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent style={{ background: "#0E0E0E", border: "1px solid rgba(255,255,255,0.08)" }}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete project?</AlertDialogTitle>
            <AlertDialogDescription style={{ color: "rgba(255,255,255,0.4)" }}>
              This will permanently delete the project and all its generated tests. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-white/10 bg-transparent text-white/60 hover:text-white hover:bg-white/5"
              data-testid="button-cancel-delete"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
              className="font-bold"
              style={{ background: "#FF2947", border: "none", color: "white" }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

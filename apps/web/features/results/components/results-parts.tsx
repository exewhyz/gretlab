"use client"

import {
  DotsThreeIcon,
  PencilSimpleIcon,
  PlusIcon,
  PrinterIcon,
} from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Progress } from "@workspace/ui/components/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmDialog } from "@/components/confirm"
import {
  Check,
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { Loading, PageTitle, Stats } from "@/features/admin/components/shell"
import { api, ApiRequestError } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { getExam } from "@/features/results/server"
import type { examResults, reportCard } from "@/features/results/server"
import type { listExams } from "@/features/results/server"
import type {
  addPapers,
  addTerm,
  examSettings,
  setPublished,
} from "@/features/results/server"

import { Exams } from "./exams-list"

export interface Band {
  min: number
  grade: string
  points?: number | null
}

export const shortDate = (day: string | null) =>
  day
    ? new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      })
    : ""

export const fmt = (n: number | null | undefined) =>
  n == null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1)

export const RESULT: Record<string, { label: string; tone: string }> = {
  pass: { label: "Pass", tone: "text-success" },
  fail: { label: "Needs to improve", tone: "text-destructive" },
  incomplete: { label: "Marks pending", tone: "text-muted-foreground" },
  none: { label: "–", tone: "text-muted-foreground" },
}

export interface ExamItem {
  id: string
  name: string
  startsOn: string | null
  endsOn: string | null
  weight: number
  termId?: string | null
  term?: string | null
  published: boolean
  papers: number
  marks: number
}

export interface Term {
  id: string
  name: string
  startsOn: string | null
  endsOn: string | null
}

export interface Paper {
  id: string
  subjectId: string
  subject: string
  maxMarks: number
  passMarks: number
  heldOn: string | null
  teacher: string | null
  entered: number
  canMark: boolean
}

"use client"

import type { hostelSetup } from "@/features/hostel/server"
import type { ApiResult } from "@/lib/api/types"

export interface Hostel {
  id: string
  name: string
  forWhom: string
  warden: string
  wardenPhone: string
  rooms: number
  beds: number
  taken: number
}

export interface Bed {
  id: string
  label: string
  taken: boolean
  resident: {
    id: string
    name: string
    classes: string[]
    canChange: boolean
  } | null
}

export interface Room {
  id: string
  name: string
  floor: string
  beds: Bed[]
}

export type Setup = ApiResult<typeof hostelSetup>

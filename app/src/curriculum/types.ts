import { Lesson } from '../lessons/types'

export type Kind = 'sim' | 'anim' | 'build'

export interface Entry {
  id: string
  title: string
  kind: Kind
  min: number
  lesson?: Lesson
}

export interface Topic {
  id: string
  title: string
  tagline: string
  entries: Entry[]
}

export interface Category {
  id: string
  title: string
  tagline: string
  icon: string
  group: 'learn' | 'practice'
  topics: Topic[]
}

export const KIND_LABEL: Record<Kind, string> = { sim: 'Live 3D', anim: 'Animation', build: 'Build' }

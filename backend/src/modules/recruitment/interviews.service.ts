import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { InterviewFeedbackListView, InterviewFeedbackView, InterviewView } from './recruitment.types';

/**
 * Interview scheduling with a panel, and scorecard feedback.
 * Scaffold stub (Keka wave D) — implemented by WS-D2.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md
 */
@Injectable()
export class InterviewsService {
  constructor(private readonly prisma: PrismaService) {}

  listForApplication(actor: AuthenticatedUser, applicationId: string): Promise<InterviewView[]> {
    void actor;
    void applicationId;
    throw new NotImplementedException();
  }

  schedule(actor: AuthenticatedUser, applicationId: string, input: Record<string, unknown>): Promise<InterviewView> {
    void actor;
    void applicationId;
    void input;
    throw new NotImplementedException();
  }

  update(actor: AuthenticatedUser, id: string, input: Record<string, unknown>): Promise<InterviewView> {
    void actor;
    void id;
    void input;
    throw new NotImplementedException();
  }

  setStatus(actor: AuthenticatedUser, id: string, status: 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'): Promise<InterviewView> {
    void actor;
    void id;
    void status;
    throw new NotImplementedException();
  }

  mine(actor: AuthenticatedUser): Promise<InterviewView[]> {
    void actor;
    throw new NotImplementedException();
  }

  listFeedback(actor: AuthenticatedUser, interviewId: string): Promise<InterviewFeedbackListView> {
    void actor;
    void interviewId;
    throw new NotImplementedException();
  }

  submitFeedback(actor: AuthenticatedUser, interviewId: string, input: Record<string, unknown>): Promise<InterviewFeedbackView> {
    void actor;
    void interviewId;
    void input;
    throw new NotImplementedException();
  }
}

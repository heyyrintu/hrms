'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import { QuestionBankTab } from './QuestionBankTab';
import { TemplatesTab } from './TemplatesTab';
import { FileText } from 'lucide-react';

export default function ReviewTemplatesPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN);
  const [tab, setTab] = useState<'bank' | 'templates'>('bank');

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-warm-500">
          Review templates are only available to HR administrators.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileText className="h-8 w-8 text-indigo-600" />
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-warm-900">Review Templates</h1>
          <p className="text-sm text-warm-500">Manage the question bank and the templates used by review cycles</p>
        </div>
      </div>

      <div className="border-b border-warm-200">
        <nav className="flex gap-4">
          {([['bank', 'Question bank'], ['templates', 'Templates']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                tab === key
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-warm-500 hover:text-warm-700'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'bank' ? <QuestionBankTab /> : <TemplatesTab />}
    </div>
  );
}

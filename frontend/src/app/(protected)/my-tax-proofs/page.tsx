'use client';

/**
 * The employee's own investment proofs.
 *
 * The declaration page takes what somebody expects to claim. This one takes the
 * evidence behind it and shows where each piece stands. The heart of the page
 * is the summary: declared against approved, head by head, because the gap
 * between the two is what decides how much tax comes out of a salary.
 *
 * Submitting is two calls — the file goes to the uploads endpoint, then the
 * proof references the upload it produced — but that is our plumbing, not the
 * employee's, so it is one button and one outcome to them. Nothing is uploaded
 * until the file and the amount have both been judged here, so a 40MB scan or
 * a mistyped figure is refused in the moment rather than after a wait.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FileCheck2, Plus, ShieldQuestion, Upload } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { proofsApi } from '@/lib/api';
import {
  InvestmentProofSection,
  InvestmentProofStatus,
  PROOF_SECTION_LABELS,
  type InvestmentProof,
  type ProofSummary,
  type ProofUpload,
} from '@/types/proofs';

import {
  currentFinancialYear,
  financialYearLabel,
  financialYearOptions,
} from '@/components/form16/financialYear';
import { ProofListItem } from '@/components/proofs/ProofListItem';
import { ProofSummaryTable } from '@/components/proofs/ProofSummaryTable';
import { VerificationNotice } from '@/components/proofs/VerificationNotice';
import {
  ACCEPTED_FILE_ATTRIBUTE,
  MAX_FILE_LABEL,
  checkClaimedAmount,
  checkProofFile,
} from '@/components/proofs/validation';

const SECTION_OPTIONS = Object.values(InvestmentProofSection).map((section) => ({
  value: section,
  label: PROOF_SECTION_LABELS[section],
}));

/** Newest first, so the thing just submitted is the thing at the top. */
function newestFirst(proofs: InvestmentProof[]): InvestmentProof[] {
  return [...proofs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export default function MyTaxProofsPage() {
  const [financialYear, setFinancialYear] = useState<number>(() => currentFinancialYear());
  const [summary, setSummary] = useState<ProofSummary | null>(null);
  const [proofs, setProofs] = useState<InvestmentProof[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Whether the employer requires verification at all, which the summary alone
   * does not say. Null until known, and null again if it cannot be read: that
   * is not the same as "no", and the notice treats it differently.
   */
  /**
   * Whether the employer requires proofs at all, as the summary reports it.
   *
   * It cannot come from the tenant configuration: that endpoint is limited to
   * payroll staff, so reading it here would fail for every ordinary employee
   * and the notice would permanently say it could not tell.
   */
  const verificationEnabled = summary?.verificationRequired ?? null;

  const [formOpen, setFormOpen] = useState(false);
  const [section, setSection] = useState<InvestmentProofSection>(
    InvestmentProofSection.SECTION_80C,
  );
  const [claimed, setClaimed] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [amountError, setAmountError] = useState<string | undefined>(undefined);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const [withdrawing, setWithdrawing] = useState<InvestmentProof | null>(null);
  const [busy, setBusy] = useState(false);

  /** Generation counter identifying the newest in-flight load. */
  const requestRef = useRef(0);

  const yearOptions = useMemo(() => financialYearOptions(), []);

  const load = useCallback(async () => {
    // The year is a click away and one request can outlive the next. Without
    // this token a slow reply would fill the page under whichever year is
    // selected by the time it lands, showing one year's proofs under another.
    const request = requestRef.current + 1;
    requestRef.current = request;

    setLoading(true);
    try {
      const [summaryResponse, listResponse] = await Promise.all([
        proofsApi.mySummary(financialYear),
        proofsApi.listMine(financialYear),
      ]);
      if (requestRef.current !== request) return;

      setSummary((summaryResponse.data ?? null) as ProofSummary | null);
      const list = listResponse.data;
      setProofs(Array.isArray(list) ? newestFirst(list as InvestmentProof[]) : []);
    } catch {
      if (requestRef.current !== request) return;
      setSummary(null);
      setProofs([]);
      toast.error('Your proofs could not be read. Nothing below is from your record.');
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [financialYear]);

  useEffect(() => {
    void load();
  }, [load]);


  const openForm = () => {
    setSection(InvestmentProofSection.SECTION_80C);
    setClaimed('');
    setDescription('');
    setFile(null);
    setAmountError(undefined);
    setFileError(undefined);
    setFormOpen(true);
  };

  const closeForm = () => {
    if (submitting) return;
    setFormOpen(false);
  };

  const handleSubmit = async () => {
    // Both judged before anything is sent, and both refusals shown at once so
    // a second mistake is not discovered only after the first is fixed.
    const amount = checkClaimedAmount(claimed);
    const document = checkProofFile(file);
    setAmountError(amount.ok ? undefined : amount.message);
    setFileError(document.ok ? undefined : document.message);

    if (!amount.ok || !document.ok) {
      toast.error('Nothing was uploaded. Check the entries marked below.');
      return;
    }

    setSubmitting(true);

    let uploadId: string;
    try {
      const response = await proofsApi.uploadFile(document.value, financialYear);
      const upload = (response.data ?? null) as ProofUpload | null;
      if (!upload?.id) throw new Error('The upload returned no id.');
      uploadId = upload.id;
    } catch {
      setSubmitting(false);
      // The proof is never created from an upload that did not happen.
      toast.error('The document could not be uploaded, so no proof was submitted.');
      return;
    }

    try {
      await proofsApi.submit({
        financialYear,
        section,
        claimedAmount: amount.value,
        uploadId,
        description: description.trim() || undefined,
      });
      toast.success('Your proof was submitted. Somebody in payroll will review it.');
      setFormOpen(false);
      await load();
    } catch {
      toast.error(
        'The document was stored but the proof was not submitted. Nothing is on your record, so try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = (proof: InvestmentProof) => {
    // Only a pending proof reaches here; a reviewed one offers no button.
    if (proof.status !== InvestmentProofStatus.PENDING) return;
    setWithdrawing(proof);
  };

  const confirmWithdraw = async () => {
    if (!withdrawing) return;
    setBusy(true);
    try {
      await proofsApi.withdraw(withdrawing.id);
      toast.success('That proof was withdrawn. Nothing it claimed is under review any more.');
      setWithdrawing(null);
      await load();
    } catch {
      toast.error('That proof could not be withdrawn. It is still on your record.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async (proof: InvestmentProof) => {
    try {
      await proofsApi.download(proof.id, proof.upload?.fileName ?? `proof-${proof.id}`);
    } catch {
      toast.error('That document could not be opened.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-warm-900 sm:text-2xl">My investment proofs</h1>
          <p className="mt-1 text-sm text-warm-600">
            The evidence behind what you declared for {financialYearLabel(financialYear)}, and
            where each document stands.
          </p>
        </div>
        <Button onClick={openForm}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Submit a proof
        </Button>
      </div>

      {/* Nothing on this page is decided by a machine, and it must not read as if it were. */}
      <Card className="border-warm-300 bg-warm-50">
        <CardContent className="flex gap-3">
          <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-warm-500" aria-hidden="true" />
          <p className="text-sm text-warm-700">
            A person in payroll reviews every document you submit here. Nothing is checked
            automatically, and no amount counts towards your tax until somebody has approved it —
            which may be for less than you claimed.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Select
            label="Financial year"
            value={String(financialYear)}
            onChange={(event) => setFinancialYear(Number(event.target.value))}
            options={yearOptions}
            className="sm:max-w-xs"
          />
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
        </div>
      ) : (
        <>
          {summary ? (
            <VerificationNotice
              verificationInForce={summary.verificationInForce}
              cutoffMonth={summary.cutoffMonth}
              verificationEnabled={verificationEnabled}
            />
          ) : null}

          <Card>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <FileCheck2 className="h-4 w-4 text-warm-400" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-warm-900">
                  Declared against approved, {financialYearLabel(financialYear)}
                </h2>
              </div>
              {summary ? (
                <ProofSummaryTable rows={summary.rows} />
              ) : (
                <p className="py-6 text-center text-sm text-warm-500">
                  Your summary could not be read, so nothing is shown here rather than a figure
                  that might be wrong.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-warm-900">Documents you have submitted</h2>
            {proofs.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center">
                  <Upload className="mx-auto mb-3 h-10 w-10 text-warm-300" aria-hidden="true" />
                  <h3 className="mb-2 text-lg font-semibold text-warm-900">
                    You have submitted nothing for {financialYearLabel(financialYear)}
                  </h3>
                  <p className="mx-auto max-w-xl text-sm text-warm-600">
                    {summary?.verificationInForce
                      ? 'Your employer is now allowing only what has been evidenced, so every head above allows nothing until a document is filed and accepted. Submit the receipts, certificates or statements that support each one.'
                      : 'Every head above still rests on your declaration alone. Submit the receipts, certificates or statements that support each one.'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              proofs.map((proof) => (
                <ProofListItem
                  key={proof.id}
                  proof={proof}
                  onWithdraw={handleWithdraw}
                  onDownload={(target) => void handleDownload(target)}
                  busy={busy}
                />
              ))
            )}
          </div>
        </>
      )}

      <Modal isOpen={formOpen} onClose={closeForm} title="Submit a proof" size="lg">
        <div className="space-y-4">
          <Select
            label="Head"
            value={section}
            onChange={(event) => setSection(event.target.value as InvestmentProofSection)}
            options={SECTION_OPTIONS}
            disabled={submitting}
          />

          <Input
            label="Amount claimed"
            value={claimed}
            onChange={(event) => {
              setClaimed(event.target.value);
              setAmountError(undefined);
            }}
            error={amountError}
            placeholder="150000"
            inputMode="decimal"
            disabled={submitting}
          />

          <div className="space-y-1.5">
            <Input
              label="Document"
              type="file"
              accept={ACCEPTED_FILE_ATTRIBUTE}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setFileError(undefined);
              }}
              error={fileError}
              disabled={submitting}
            />
            <p className="text-xs text-warm-500">
              {`Accepted: PDF, JPEG, PNG, GIF or WebP, up to ${MAX_FILE_LABEL}.`}
            </p>
          </div>

          <Input
            label="What this document is"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="LIC premium receipt, April to March"
            disabled={submitting}
          />

          <p className="text-xs text-warm-500">
            The document is stored first and the claim is recorded against it. If the upload
            fails, nothing is recorded at all.
          </p>
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={closeForm} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting} disabled={submitting}>
            Upload and submit
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={withdrawing !== null}
        onClose={() => (busy ? undefined : setWithdrawing(null))}
        title="Withdraw this proof?"
        size="sm"
      >
        <p className="text-sm text-warm-700">
          {withdrawing
            ? `This removes the document you submitted for ${
                PROOF_SECTION_LABELS[withdrawing.section] ?? withdrawing.section
              } from review. Nothing it claims will count, and you would have to submit it again.`
            : null}
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setWithdrawing(null)} disabled={busy}>
            Keep it
          </Button>
          <Button variant="danger" onClick={() => void confirmWithdraw()} disabled={busy}>
            Withdraw proof
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Captions, FileText, RefreshCw, Save } from 'lucide-react';
import type { EditableSubtitleDocument, SubtitleAttachment } from '../services/subtitles';
import {
  findSubtitleCueAtTime,
  parseEditableSubtitleDocument,
  updateSubtitleCueText
} from '../services/subtitles';

interface SubtitleEditorSidebarProps {
  videoPath: string;
  currentTime: number;
  subtitleAttachment?: SubtitleAttachment | null;
  refreshSignal: number;
  onSubtitleSaved?: () => void;
}

function formatCueTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = Math.floor(safeSeconds % 60);
  const milliseconds = Math.round((safeSeconds - Math.floor(safeSeconds)) * 1000);

  const timeText = hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return `${timeText}.${String(milliseconds).padStart(3, '0')}`;
}

function isEditableSubtitleAttachment(subtitle?: SubtitleAttachment | null): subtitle is SubtitleAttachment {
  return subtitle?.type === 'srt' || subtitle?.type === 'vtt';
}

export default function SubtitleEditorSidebar({
  videoPath,
  currentTime,
  subtitleAttachment,
  refreshSignal,
  onSubtitleSaved
}: SubtitleEditorSidebarProps) {
  const [content, setContent] = useState('');
  const [document, setDocument] = useState<EditableSubtitleDocument | null>(null);
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activeCue = useMemo(() => {
    if (!document || !subtitleAttachment) return null;
    return findSubtitleCueAtTime(document.cues, currentTime, subtitleAttachment.offset || 0);
  }, [document, currentTime, subtitleAttachment?.offset]);

  const selectedCue = useMemo(() => {
    if (!document || !selectedCueId) return null;
    return document.cues.find(cue => cue.id === selectedCueId) || null;
  }, [document, selectedCueId]);

  const loadSubtitle = async () => {
    setError('');
    setNotice('');
    setIsDirty(false);
    setSelectedCueId(null);
    setDraftText('');
    setContent('');
    setDocument(null);

    if (!subtitleAttachment) {
      setError('当前视频没有挂载字幕');
      return;
    }

    if (!isEditableSubtitleAttachment(subtitleAttachment)) {
      setError('当前字幕格式暂不支持直接编辑');
      return;
    }

    const api = (window as any).electronAPI;
    if (!api?.readSubtitleFile) {
      setError('当前环境不支持字幕文件编辑');
      return;
    }

    setIsLoading(true);
    try {
      const result = await api.readSubtitleFile(subtitleAttachment.path);
      if (!result?.success || typeof result.content !== 'string' || !result.type) {
        throw new Error(result?.error || '字幕文件读取失败');
      }

      const nextDocument = parseEditableSubtitleDocument(result.content, result.type);
      setContent(result.content);
      setDocument(nextDocument);
      setNotice(nextDocument.cues.length > 0 ? '' : '没有找到可编辑的字幕行');
    } catch (err: any) {
      setError(err?.message || '字幕文件读取失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSubtitle();
  }, [videoPath, subtitleAttachment?.path, subtitleAttachment?.type, refreshSignal]);

  useEffect(() => {
    if (!isDirty) {
      setSelectedCueId(activeCue?.id || null);
    }
  }, [activeCue?.id, isDirty]);

  useEffect(() => {
    if (!isDirty) {
      setDraftText(selectedCue?.text || '');
    }
  }, [selectedCue?.id, selectedCue?.text, isDirty]);

  const handleSave = async () => {
    if (!document || !selectedCue || !subtitleAttachment) return;

    const api = (window as any).electronAPI;
    if (!api?.writeSubtitleFile) {
      setError('当前环境不支持字幕文件保存');
      return;
    }

    setIsSaving(true);
    setError('');
    setNotice('');

    try {
      const nextContent = updateSubtitleCueText(content, document.type, selectedCue.id, draftText);
      const result = await api.writeSubtitleFile(subtitleAttachment.path, nextContent);
      if (!result?.success) {
        throw new Error(result?.error || '字幕文件保存失败');
      }

      setContent(nextContent);
      setDocument(parseEditableSubtitleDocument(nextContent, document.type));
      setIsDirty(false);
      setNotice('已保存到原字幕文件，并保留 .bak 备份');
      onSubtitleSaved?.();
    } catch (err: any) {
      setError(err?.message || '字幕文件保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const canEdit = Boolean(document && selectedCue && isEditableSubtitleAttachment(subtitleAttachment));
  const hasSubtitle = Boolean(subtitleAttachment);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-black/5 bg-white/50 shadow-sm">
      <div className="flex items-center justify-between border-b border-black/5 bg-black/[0.01] p-4">
        <div className="flex min-w-0 items-center gap-2">
          <Captions size={18} className="shrink-0 text-on-surface" />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-on-surface">字幕校对</h3>
            <p className="truncate text-[10px] font-medium text-on-surface-variant">
              {subtitleAttachment?.name || '未挂载字幕'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={loadSubtitle}
          disabled={!hasSubtitle || isLoading || isSaving}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/5 bg-white/70 text-on-surface-variant transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          title="重新读取字幕"
          aria-label="重新读取字幕"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 custom-scrollbar">
        {subtitleAttachment && (
          <div className="flex items-start gap-2 rounded-xl border border-black/5 bg-white/70 p-3">
            <FileText size={15} className="mt-0.5 shrink-0 text-primary" />
            <div className="min-w-0 text-[11px] leading-relaxed">
              <p className="truncate font-bold text-on-surface" title={subtitleAttachment.path}>
                {subtitleAttachment.path}
              </p>
              <p className="mt-0.5 text-on-surface-variant">
                {document ? `${document.cues.length} 条字幕` : subtitleAttachment.type.toUpperCase()}
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {notice && !error && (
          <div className="rounded-xl border border-primary/15 bg-primary/5 p-3 text-xs font-semibold text-primary">
            {notice}
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-xs font-semibold text-on-surface-variant">
            正在读取字幕...
          </div>
        ) : canEdit && selectedCue ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="rounded-xl border border-black/5 bg-white/80 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-on-surface-variant">
                  {isDirty ? '正在编辑' : '当前字幕'}
                </span>
                <span className="shrink-0 text-[10px] font-bold tabular-nums text-primary">
                  {formatCueTime(selectedCue.startTime)} - {formatCueTime(selectedCue.endTime)}
                </span>
              </div>
              <textarea
                value={draftText}
                onChange={event => {
                  setDraftText(event.target.value);
                  setIsDirty(true);
                }}
                className="h-40 w-full resize-none rounded-xl border border-black/10 bg-black/[0.02] p-3 text-sm leading-relaxed text-on-surface outline-none transition focus:border-primary focus:bg-white"
              />
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || isSaving}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-bold text-white shadow-md shadow-primary/10 transition hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save size={15} />
              {isSaving ? '保存中...' : '保存到原字幕文件'}
            </button>
          </div>
        ) : !error ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-black/10 bg-white/45 p-5 text-center text-xs font-semibold leading-relaxed text-on-surface-variant">
            当前时间没有可编辑字幕
          </div>
        ) : null}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useOrbitHost } from '../../sdk/host';
import { AppIcon, CenteredModal, IconPicker } from '../../sdk/primitives';
import type { SettingsPanelProps } from '../../sdk/types';
import type { SearchEngine } from '../../types';

export function SearchSettingsPanel({ highlightSection }: SettingsPanelProps) {
  const host = useOrbitHost();
  const { settings, updateSettings, toast } = host;

  const [editingEngineId, setEditingEngineId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newEngName, setNewEngName] = useState('');
  const [newEngKey, setNewEngKey] = useState('');
  const [newEngUrl, setNewEngUrl] = useState('');
  const [newEngIcon, setNewEngIcon] = useState('');
  const [newEngColor, setNewEngColor] = useState('#38bdf8');

  useEffect(() => {
    if (!addModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setAddModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [addModalOpen]);

  const sectionHighlightStyle = (sectionId: string): React.CSSProperties =>
    highlightSection === sectionId
      ? {
          boxShadow: '0 0 0 2px var(--brand)',
          borderRadius: 'var(--radius-lg)',
          padding: '8px',
          transition: 'all 220ms ease',
        }
      : { transition: 'all 220ms ease' };

  const handleUpdateEngine = (id: string, patch: Partial<SearchEngine>) => {
    const next = settings.engines.map((e) => (e.id === id ? { ...e, ...patch } : e));
    updateSettings({ engines: next });
  };

  const resetAddDraft = () => {
    setNewEngName('');
    setNewEngKey('');
    setNewEngUrl('');
    setNewEngIcon('');
    setNewEngColor('#38bdf8');
  };

  const handleAddEngine = () => {
    const name = newEngName.trim();
    const url = newEngUrl.trim();
    if (!name) {
      toast('请填写引擎名称', true);
      return;
    }
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      toast('请填写有效的 http/https 搜索地址', true);
      return;
    }
    const prefix = (newEngKey.trim() || name.slice(0, 2)).toLowerCase();
    const eng: SearchEngine = {
      id: `eng_${Date.now()}`,
      name,
      key: prefix,
      url,
      color: newEngColor,
      icon: newEngIcon.trim(),
    };
    const next = [...settings.engines];
    next.splice(Math.max(0, next.length - 1), 0, eng);
    updateSettings({ engines: next, activeEngineId: eng.id });
    resetAddDraft();
    setAddModalOpen(false);
    toast(`已添加 ${name}`);
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--input-bg)',
    border: '1px solid var(--glass-border)',
    color: 'var(--ink)',
  };

  return (
    <>
      <section
        data-section="sec-search-bar"
        style={sectionHighlightStyle('sec-search-bar')}
        className="space-y-3"
      >
        <div className="font-medium text-sm">搜索栏</div>
        <label
          className="px-3 py-2.5 rounded-xl flex items-center justify-between cursor-pointer"
          style={{ background: 'var(--pill-bg)' }}
        >
          <span className="font-medium">仅显示搜索引擎图标</span>
          <input
            type="checkbox"
            checked={settings.searchIconOnly}
            onChange={(e) => updateSettings({ searchIconOnly: e.target.checked })}
            className="w-4 h-4 accent-indigo-500"
          />
        </label>
      </section>

      <section
        data-section="sec-search-eng"
        style={{ ...sectionHighlightStyle('sec-search-eng'), borderColor: 'var(--glass-border)' }}
        className="space-y-2.5 pt-4 border-t"
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">搜索引擎</span>
            <span style={{ color: 'var(--ink-muted)' }}>前缀 + 空格切换</span>
          </div>
          <button
            type="button"
            onClick={() => {
              resetAddDraft();
              setAddModalOpen(true);
            }}
            className="h-8 px-3 rounded-lg font-medium text-white flex items-center gap-1 cursor-pointer shrink-0"
            style={{ background: 'var(--brand-solid)' }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>添加引擎</span>
          </button>
        </div>

        <div className="space-y-2">
          {settings.engines.map((e) => {
            const isEditing = editingEngineId === e.id;
            return (
              <div
                key={e.id}
                className="rounded-xl p-2.5 space-y-2.5"
                style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AppIcon
                      icon={e.icon}
                      title={e.name}
                      color={e.color}
                      engineId={e.id}
                      targetUrl={e.url}
                      boxClass="w-7 h-7"
                      iconClass="w-3.5 h-3.5"
                      roundedClass="rounded-lg"
                    />
                    <div className="min-w-0">
                      <div className="font-medium flex items-center gap-1.5">
                        <span>{e.name}</span>
                        <span className="kbd-chip">{e.key}</span>
                      </div>
                      <div
                        className={`${e.url ? 'font-mono ' : ''}truncate`}
                        style={{ color: 'var(--ink-muted)' }}
                      >
                        {e.url || '站内检索'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingEngineId(isEditing ? null : e.id)}
                      className="px-2.5 py-1 rounded-lg cursor-pointer orbit-hover"
                      style={{ background: 'var(--pill-hover)' }}
                    >
                      {isEditing ? '收起' : '编辑'}
                    </button>
                    {e.id !== 'local' && settings.engines.length > 2 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = settings.engines.filter((x) => x.id !== e.id);
                          updateSettings({
                            engines: next,
                            activeEngineId:
                              settings.activeEngineId === e.id ? next[0].id : settings.activeEngineId,
                          });
                        }}
                        className="p-1.5 rounded-lg cursor-pointer orbit-hover"
                        style={{ color: 'var(--danger)' }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div
                    className="pt-2 border-t space-y-2"
                    style={{ borderColor: 'var(--glass-border)' }}
                  >
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={e.name}
                        placeholder="名称"
                        onChange={(ev) => handleUpdateEngine(e.id, { name: ev.target.value })}
                        className="col-span-2 h-8 px-2.5 rounded-lg focus:outline-none"
                        style={inputStyle}
                      />
                      <input
                        type="text"
                        value={e.key}
                        placeholder="前缀"
                        onChange={(ev) => handleUpdateEngine(e.id, { key: ev.target.value })}
                        className="h-8 px-2.5 rounded-lg font-mono focus:outline-none"
                        style={inputStyle}
                      />
                    </div>
                    {e.id !== 'local' && (
                      <input
                        type="text"
                        value={e.url}
                        placeholder="搜索 URL（{q} 替换关键词）"
                        onChange={(ev) => handleUpdateEngine(e.id, { url: ev.target.value })}
                        className="w-full h-8 px-2.5 rounded-lg font-mono focus:outline-none"
                        style={inputStyle}
                      />
                    )}
                    <IconPicker
                      compact
                      icon={e.icon || ''}
                      color={e.color || '#60a5fa'}
                      title={e.name}
                      engineId={e.id}
                      fetchTargetUrl={e.url}
                      onChangeIcon={(icon) => handleUpdateEngine(e.id, { icon })}
                      onChangeColor={(color) => handleUpdateEngine(e.id, { color })}
                      onToast={toast}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <CenteredModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        zIndexClass="z-[60]"
        panelClassName="w-full max-w-md p-5 space-y-3.5 text-xs"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">添加搜索引擎</h3>
          <button
            type="button"
            onClick={() => setAddModalOpen(false)}
            className="p-1 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <input
            type="text"
            autoFocus
            placeholder="名称 (如 Perplexity)"
            value={newEngName}
            onChange={(e) => setNewEngName(e.target.value)}
            className="col-span-2 h-8 px-2.5 rounded-lg focus:outline-none"
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="前缀 (px)"
            value={newEngKey}
            onChange={(e) => setNewEngKey(e.target.value)}
            className="h-8 px-2.5 rounded-lg font-mono focus:outline-none"
            style={inputStyle}
          />
        </div>

        <input
          type="text"
          placeholder="https://www.perplexity.ai/search?q={q}"
          value={newEngUrl}
          onChange={(e) => setNewEngUrl(e.target.value)}
          className="w-full h-8 px-2.5 rounded-lg font-mono focus:outline-none"
          style={inputStyle}
        />

        <IconPicker
          compact
          icon={newEngIcon}
          color={newEngColor}
          title={newEngName || 'S'}
          fetchTargetUrl={newEngUrl}
          onChangeIcon={setNewEngIcon}
          onChangeColor={setNewEngColor}
          onToast={toast}
        />

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setAddModalOpen(false)}
            className="h-8 px-3 rounded-lg cursor-pointer"
            style={{ background: 'var(--pill-hover)' }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleAddEngine}
            className="h-8 px-4 rounded-lg font-medium text-white cursor-pointer"
            style={{ background: 'var(--brand-solid)' }}
          >
            添加
          </button>
        </div>
      </CenteredModal>
    </>
  );
}

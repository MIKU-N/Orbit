import { LayoutGrid, LogOut, Plug, Settings, UserCog } from 'lucide-react';
import type { User } from '../types';

export type SettingsTab = string;

interface AccountPopoverProps {
  open: boolean;
  user: User;
  onClose: () => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  onStartLayoutEdit: () => void;
  onLogout: () => void;
}

export function AccountPopover({
  open,
  user,
  onClose,
  onOpenSettings,
  onStartLayoutEdit,
  onLogout,
}: AccountPopoverProps) {
  if (!open) return null;

  return (
    <div
      id="accountPanel"
      onClick={(e) => e.stopPropagation()}
      className="fixed top-16 right-4 sm:right-6 z-40 w-56 max-w-[calc(100vw-2rem)] glass-strong rounded-2xl p-2.5 space-y-1.5 pop-in text-xs"
    >
      <div
        className="flex items-center gap-2.5 px-2 py-2 border-b"
        style={{ borderColor: 'var(--glass-border)' }}
      >
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold shrink-0"
          style={{ background: 'var(--brand-solid)' }}
        >
          {(user.username?.[0] || 'O').toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">{user.username}</div>
          <div className="font-mono" style={{ color: 'var(--ink-muted)' }}>
            {user.role === 'admin' ? '管理员' : '子账号'}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenSettings('appearance');
        }}
        className="w-full px-2.5 py-2 rounded-xl flex items-center gap-2.5 hover:bg-white/10 cursor-pointer text-left transition-colors"
      >
        <Settings className="w-4 h-4 opacity-80" />
        <span>系统设置</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenSettings('plugins');
        }}
        className="w-full px-2.5 py-2 rounded-xl flex items-center gap-2.5 hover:bg-white/10 cursor-pointer text-left transition-colors"
      >
        <Plug className="w-4 h-4 opacity-80" />
        <span>插件中心</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenSettings('account');
        }}
        className="w-full px-2.5 py-2 rounded-xl flex items-center gap-2.5 hover:bg-white/10 cursor-pointer text-left transition-colors"
      >
        <UserCog className="w-4 h-4 opacity-80" />
        <span>账号管理</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onClose();
          onStartLayoutEdit();
        }}
        className="hidden md:flex w-full px-2.5 py-2 rounded-xl items-center gap-2.5 hover:bg-white/10 cursor-pointer text-left transition-colors"
      >
        <LayoutGrid className="w-4 h-4 opacity-80" />
        <span>自由拖拽布局</span>
      </button>

      <div className="pt-1 border-t" style={{ borderColor: 'var(--glass-border)' }}>
        <button
          type="button"
          onClick={onLogout}
          className="w-full px-2.5 py-2 rounded-xl flex items-center gap-2.5 hover:bg-white/10 hover:text-red-400 cursor-pointer text-left transition-colors"
          style={{ color: 'var(--ink-muted)' }}
        >
          <LogOut className="w-4 h-4" />
          <span>退出登录</span>
        </button>
      </div>
    </div>
  );
}

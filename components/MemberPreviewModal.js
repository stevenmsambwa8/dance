'use client'
/**
 * MemberPreviewModal — quick-view popover shown when tapping a member
 * row in clan/squad pages, instead of jumping straight to their full
 * profile. Pulls the same fields already used elsewhere (RANK_META,
 * UserBadges, presence) and offers a "View Full Profile" link for
 * anyone who wants the deep dive.
 *
 * Usage:
 *   const [previewUser, setPreviewUser] = useState(null)
 *   <div onClick={() => setPreviewUser(member)}>...</div>
 *   <MemberPreviewModal member={previewUser} onClose={() => setPreviewUser(null)} />
 *
 * `member` expects a clan_members-style row with a nested `profiles` object:
 *   { user_id, role, profiles: { id, username, avatar_url, tier, level,
 *     wins, total_matches, followers_count, country_flag, plan,
 *     plan_expires_at, email, is_season_winner } }
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { RANK_META } from '../lib/constants'
import { useOnlineUsers } from '../lib/usePresence'
import { presenceLabel } from '../lib/lastSeen'
import UserBadges from './UserBadges'

export default function MemberPreviewModal({ member, squadName, onClose }) {
  const router = useRouter()
  const sheetRef = useRef(null)
  const onlineIds = useOnlineUsers()
  const [fullProfile, setFullProfile] = useState(null)

  const p = member?.profiles

  useEffect(() => {
    if (!member?.user_id) { setFullProfile(null); return }
    // member rows passed from list queries are usually partial — fetch
    // a couple of extra stat fields not already selected upstream.
    supabase
      .from('profiles')
      .select('last_seen, wins, total_matches, followers_count, country_flag, plan, plan_expires_at, is_season_winner, email, tier, level, avatar_url, username')
      .eq('id', member.user_id)
      .single()
      .then(({ data }) => setFullProfile(data))
  }, [member?.user_id])

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    if (member) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [member, onClose])

  if (!member) return null

  const merged = { ...p, ...fullProfile }
  const isOnline = onlineIds.has(member.user_id)
  const presence = presenceLabel(isOnline, merged.last_seen)
  const rankMeta = RANK_META[merged.tier] || RANK_META.Gold
  const wr = merged.wins && merged.total_matches
    ? Math.round((merged.wins / merged.total_matches) * 100) : null

  return (
    <div className="mpm-overlay" onClick={onClose}>
      <div className="mpm-sheet" ref={sheetRef} onClick={e => e.stopPropagation()}>
        <button className="mpm-close" onClick={onClose}><i className="ri-close-line"/></button>

        <div className="mpm-header">
          <div className="mpm-avatarWrap">
            <div className="mpm-avatar">
              {merged.avatar_url
                ? <img src={merged.avatar_url} alt=""/>
                : <span>{(merged.username || '?').slice(0,2).toUpperCase()}</span>
              }
            </div>
            <span className="mpm-dot" style={{ background: presence.dotColor }}/>
          </div>
          <div className="mpm-nameBlock">
            <span className="mpm-name">
              {merged.username}
              <UserBadges
                email={merged.email} plan={merged.plan} planExpiresAt={merged.plan_expires_at}
                countryFlag={merged.country_flag} isSeasonWinner={merged.is_season_winner}
                size={13} gap={2}/>
            </span>
            <span className="mpm-presence" style={{ color: presence.color }}>{presence.text}</span>
          </div>
        </div>

        {/* Clan/squad role context */}
        <div className="mpm-roleRow">
          {member.role === 'leader' && <span className="mpm-roleChip mpm-roleLeader"><i className="ri-vip-crown-line"/> Clan Leader</span>}
          {member.role === 'squad_leader' && <span className="mpm-roleChip mpm-roleSquad"><i className="ri-star-fill"/> Squad Leader{squadName ? ` · ${squadName}` : ''}</span>}
          {member.role === 'member' && squadName && <span className="mpm-roleChip">Member · {squadName}</span>}
          {member.role === 'member' && !squadName && <span className="mpm-roleChip">Unassigned</span>}
        </div>

        {/* Stats grid */}
        <div className="mpm-statsGrid">
          <div className="mpm-statBox">
            <span className="mpm-statNum" style={{ color: rankMeta.color }}>{merged.tier || '—'}</span>
            <span className="mpm-statLabel">Rank</span>
          </div>
          <div className="mpm-statBox">
            <span className="mpm-statNum">Lv.{merged.level ?? 1}</span>
            <span className="mpm-statLabel">Level</span>
          </div>
          <div className="mpm-statBox">
            <span className="mpm-statNum">{merged.wins ?? 0}</span>
            <span className="mpm-statLabel">Wins</span>
          </div>
          <div className="mpm-statBox">
            <span className="mpm-statNum">{wr !== null ? `${wr}%` : '—'}</span>
            <span className="mpm-statLabel">Win Rate</span>
          </div>
        </div>

        {merged.followers_count != null && (
          <p className="mpm-followers"><i className="ri-user-follow-line"/> {merged.followers_count} followers</p>
        )}

        <button className="mpm-fullProfileBtn"
          onClick={() => router.push(`/profile/${member.user_id}`)}>
          View Full Profile <i className="ri-arrow-right-line"/>
        </button>
      </div>

      <style jsx>{`
        .mpm-overlay {
          position: fixed; inset: 0; z-index: 9998;
          background: rgba(0,0,0,0.5);
          display: flex; align-items: flex-end; justify-content: center;
          animation: mpm-fade-in 0.15s ease;
        }
        @keyframes mpm-fade-in { from { opacity: 0; } to { opacity: 1; } }

        .mpm-sheet {
          position: relative;
          width: 100%; max-width: 420px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-bottom: none;
          border-radius: 20px 20px 0 0;
          padding: 20px 18px calc(20px + env(safe-area-inset-bottom, 0px));
          animation: mpm-slide-up 0.2s ease;
        }
        @keyframes mpm-slide-up { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

        @media (min-width: 480px) {
          .mpm-overlay { align-items: center; }
          .mpm-sheet { border-radius: 20px; border-bottom: 1px solid var(--border); }
        }

        .mpm-close {
          position: absolute; top: 14px; right: 14px;
          width: 30px; height: 30px; border-radius: 9px;
          background: var(--surface); border: 1px solid var(--border-dark);
          display: flex; align-items: center; justify-content: center;
          color: var(--text-dim); font-size: 16px; cursor: pointer;
        }

        .mpm-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; padding-right: 36px; }
        .mpm-avatarWrap { position: relative; flex-shrink: 0; }
        .mpm-avatar {
          width: 56px; height: 56px; border-radius: 14px;
          background: var(--bg-2);
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; font-weight: 800; color: var(--text);
          overflow: hidden;
        }
        .mpm-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .mpm-dot {
          position: absolute; bottom: -2px; right: -2px;
          width: 14px; height: 14px; border-radius: 50%;
          border: 3px solid var(--bg);
        }

        .mpm-nameBlock { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .mpm-name { font-size: 16px; font-weight: 800; display: flex; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mpm-presence { font-size: 11px; font-weight: 600; }

        .mpm-roleRow { margin-bottom: 14px; }
        .mpm-roleChip {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 11px; font-weight: 700;
          padding: 5px 10px; border-radius: 8px;
          background: var(--surface); border: 1px solid var(--border-dark);
          color: var(--text-dim);
        }
        .mpm-roleLeader { color: #f59e0b; border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.06); }
        .mpm-roleSquad { color: #38bdf8; border-color: rgba(56,189,248,0.3); background: rgba(56,189,248,0.06); }

        .mpm-statsGrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px; }
        .mpm-statBox {
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          padding: 10px 4px; border-radius: 10px;
          background: var(--surface); border: 1px solid var(--border);
        }
        .mpm-statNum { font-size: 13px; font-weight: 800; }
        .mpm-statLabel { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }

        .mpm-followers {
          display: flex; align-items: center; gap: 5px;
          font-size: 11.5px; color: var(--text-muted); font-weight: 600;
          margin: 0 0 16px;
        }

        .mpm-fullProfileBtn {
          width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;
          padding: 12px 0; border-radius: 10px;
          background: var(--text); color: var(--bg); border: none;
          font-size: 13px; font-weight: 800; cursor: pointer;
        }
      `}</style>
    </div>
  )
}

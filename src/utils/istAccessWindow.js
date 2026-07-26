/**
 * istAccessWindow.js — Next One Realty CRM
 *
 * Shared 9:00 AM – 9:00 PM IST access window used to gate login, check-in/
 * check-out, and (via the auth middleware) every authenticated request for
 * non-admin roles. Centralized here since the same window is now enforced
 * in three separate places and must stay in sync.
 */

const WINDOW_START = '09:00' // IST
const WINDOW_END   = '21:00' // IST

// Convert any Date to IST minutes-since-midnight, regardless of server timezone
const getISTMinutes = (date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(date)
  const h = parseInt(parts.find(p => p.type === 'hour').value)
  const m = parseInt(parts.find(p => p.type === 'minute').value)
  return h * 60 + m
}

const isWithinAccessWindow = (date = new Date()) => {
  const totalMinutes = getISTMinutes(date)
  const [startH, startM] = WINDOW_START.split(':').map(Number)
  const [endH, endM]     = WINDOW_END.split(':').map(Number)
  return totalMinutes >= (startH * 60 + startM) && totalMinutes <= (endH * 60 + endM)
}

// e.g. "8:52 PM" — always IST regardless of server timezone
const formatISTTime = (date = new Date()) => new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
}).format(date).toUpperCase()

const EXEMPT_ROLES = ['super_admin', 'admin']

module.exports = { getISTMinutes, isWithinAccessWindow, formatISTTime, EXEMPT_ROLES, WINDOW_START, WINDOW_END }

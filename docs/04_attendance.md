# 04. Attendance Management

Source file: `routes/attendance.js` (2446 lines)

---

## 1. Endpoints

| Method | Path                         | Auth         | Description                     |
| ------ | ---------------------------- | ------------ | ------------------------------- |
| GET    | /attendance-main             | requireLogin | Attendance main page            |
| POST   | /attendance/check-in         | requireLogin | Clock in                        |
| POST   | /attendance/check-out        | requireLogin | Clock out                       |
| POST   | /attendance/lunch-start      | requireLogin | Lunch break start               |
| POST   | /attendance/lunch-end        | requireLogin | Lunch break end                 |
| GET    | /attendance/monthly          | requireLogin | Monthly attendance list         |
| GET    | /attendance/detail/:date     | requireLogin | Daily detail view               |
| POST   | /attendance/edit             | requireLogin | Edit attendance record          |
| POST   | /attendance/bulk-register    | requireLogin | Bulk register (manual entry)    |
| POST   | /attendance/request-approval | requireLogin | Submit monthly approval request |
| POST   | /attendance/cancel-approval  | requireLogin | Cancel approval request         |
| GET    | /attendance/export-csv       | requireLogin | CSV export                      |
| GET    | /attendance/summary          | requireLogin | Summary data (API)              |
| POST   | /attendance/delete           | isAdmin      | Delete record                   |
| GET    | /attendance/all              | isAdmin      | All employees' records          |

---

## 2. GPS Punch Flow

### Client-side

```
navigator.geolocation.getCurrentPosition()
  → POST {lat, lng} to /attendance/check-in
```

### Server-side

```
For each ApprovedLocation:
  distance = haversine(userLat, userLng, loc.lat, loc.lng)
  If distance <= loc.radius → gpsLocation = loc.name (OK)
If no match → reject or flag
```

---

## 3. Work Hours Calculation

```
totalHours = (checkOut - checkIn) in hours
lunchTime = (lunchEnd - lunchStart) in hours  [default 1h if not clocked]
workingHours = totalHours - lunchTime
overtimeHours = max(0, workingHours - 8)
status = 正常 / 遅刻 / 早退 / 欠勤  (based on checkIn/checkOut time vs shift)
```

---

## 4. Bulk Register Flow

```
POST /attendance/bulk-register
  → For each submitted day:
      Skip if status is "approved" (isConfirmed=true)
      Save/update Attendance record
  → Note: Cannot overwrite approved records
```

---

## 5. Monthly Approval Flow

```
POST /attendance/request-approval
  → Check: no pending ApprovalRequest exists
  → ApprovalRequest.create({userId, year, month, status:'pending'})
  → Notify admin via Notification + email
```

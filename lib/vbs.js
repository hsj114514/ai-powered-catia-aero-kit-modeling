// SPDX-License-Identifier: GPL-3.0-only
/**
 * VBScript assembly for the CATIA bridge.
 *
 * Two environment facts shape everything here. A script run by this harness may not write to
 * stdout (the sandbox terminates it) and may not call `TextStream.Flush` (same). So reports are
 * appended one open/write/close cycle per record, which also means a script that dies halfway
 * still leaves every step it completed on disk.
 *
 * Generated bodies never declare `Option Explicit`: op code is emitted as a flat statement list
 * and implicit variables keep that generator simple. Helpers declared here do the defensive work,
 * each carrying its own `On Error Resume Next` because VBScript error handling is per-procedure.
 *
 * @module lib/vbs
 */

/**
 * Encode a JavaScript string as a VBScript string literal.
 * @param value - the text.
 * @returns the quoted literal.
 */
export function vbsStr(value) {
  return String(value).split(/([\u0000-\u001f])/).map((part) => /^[\u0000-\u001f]$/.test(part) ? `ChrW(${part.charCodeAt(0)})` : `"${part.replace(/"/g, '""')}"`).join(' & ');
}

/**
 * Encode a JavaScript number as a VBScript numeric literal.
 * @param value - the number.
 * @returns the literal.
 */
export function vbsNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`not a finite number: ${value}`);
  return n.toFixed(6);
}

/**
 * Emit one guarded step: it runs only while the script has not already failed.
 * @param tag - the step label reported on failure.
 * @param lines - VBScript statements.
 * @returns the VBScript block.
 */
export function step(tag, lines) {
  const body = Array.isArray(lines) ? lines.join('\n') : String(lines);
  return [
    'If gFatal = "" Then',
    body.trimEnd(),
    `  Chk ${vbsStr(tag)}`,
    'End If',
  ].join('\n');
}

/**
 * The VBScript helper library every generated script starts with.
 * Placeholders: `@@REPORT@@`, `@@OP@@`, `@@TITLE@@`.
 * @returns the prelude source.
 */
export const PRELUDE = `' ==== dsh catia-aero prelude ====
Dim gFso, gReportPath, gOp, gTitle, gFatal, gStepSeq
Dim CATIA, gDoc, gPart, gHsf, gHb, gSpa, gOriginalAlerts, gAttached, gKeepGeometry, gOwnedDocument
Dim gTrash, gSecs, gFeats, gSectPts

Set gFso = CreateObject("Scripting.FileSystemObject")
gReportPath = @@REPORT@@
gOp = @@OP@@
gTitle = @@TITLE@@
gFatal = ""
gStepSeq = 0
gAttached = False
gKeepGeometry = False
gOwnedDocument = False
Set gDoc = Nothing
Set gPart = Nothing
Set gTrash = CreateObject("Scripting.Dictionary")
Set gSecs = CreateObject("Scripting.Dictionary")
Set gFeats = CreateObject("Scripting.Dictionary")
Set gSectPts = CreateObject("Scripting.Dictionary")
gFso.CreateTextFile(gReportPath, True, True).Close

' Script-level error handling. VBScript scopes On Error to the procedure it appears in, so this
' covers the generated operation body while every helper carries its own.
On Error Resume Next

Sub Emit(k, v)
  Dim f, s
  On Error Resume Next
  s = Replace(Replace(CStr(v), vbCr, " "), vbLf, " ")
  Set f = gFso.OpenTextFile(gReportPath, 8, True, -1)
  f.WriteLine k & vbTab & s
  f.Close
  Err.Clear
End Sub

Sub Note(m)
  Emit "MSG", m
End Sub

Sub Fail(m)
  If gFatal = "" Then
    gFatal = m
    Emit "FAILSTEP", m
  End If
End Sub

Sub Chk(tag)
  If Err.Number <> 0 Then
    Fail tag & " :: " & Err.Number & " :: " & Err.Description
  End If
  Err.Clear
End Sub

Sub Proceed()
  gStepSeq = gStepSeq + 1
End Sub

' ---- CATIA session ----
Sub AttachCatia()
  Dim c
  On Error Resume Next
  Set c = GetObject("", "CATIA.Application")
  If Err.Number <> 0 Or c Is Nothing Then
    Err.Clear
    Set c = CreateObject("CATIA.Application")
  End If
  If Err.Number <> 0 Or c Is Nothing Then
    Fail "cannot attach to the CATIA automation server :: " & Err.Number & " :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  Set CATIA = c
  CATIA.Visible = True
  gOriginalAlerts = CATIA.DisplayFileAlerts
  gAttached = True
  CATIA.DisplayFileAlerts = False
  Err.Clear
End Sub

Function FindDocument(nm)
  Dim d
  On Error Resume Next
  Set FindDocument = Nothing
  For Each d In CATIA.Documents
    If LCase(d.Name) = LCase(nm) Then
      Set FindDocument = d
      Exit Function
    End If
  Next
  Err.Clear
End Function

' Resolve the part the operation works on. Never creates a document silently.
Sub UseDocument(nm, diskPath)
  Dim d
  On Error Resume Next
  gOwnedDocument = False
  Set d = FindDocument(nm)
  If d Is Nothing Then
    Set d = CATIA.Documents.Open(diskPath)
    If Err.Number <> 0 Then
      Fail "working copy is neither open nor readable :: " & diskPath & " :: " & Err.Description
      Err.Clear
      Exit Sub
    End If
  End If
  Err.Clear
  Set gDoc = d
  Set gPart = d.Part
  If gPart Is Nothing Then
    Fail "not a part document :: " & nm
    Exit Sub
  End If
  Set gHsf = gPart.HybridShapeFactory
  If gHsf Is Nothing Then Fail "no HybridShapeFactory (GSD) on :: " & nm
  Emit "doc", gDoc.Name
  Emit "path", gDoc.FullName
  Err.Clear
End Sub

' The document an op is about to create.
Sub NewDocument()
  Dim d
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  Set d = CATIA.Documents.Add("Part")
  If Err.Number <> 0 Or d Is Nothing Then
    Fail "cannot create a part document :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  Set gDoc = d
  Set gPart = d.Part
  Set gHsf = gPart.HybridShapeFactory
  gOwnedDocument = True
  Emit "doc", gDoc.Name
  Err.Clear
End Sub

' ---- geometry ----
' Features are renamed to the element id so a later script can find them by name. Renaming is
' best-effort: the actual name is always reported back, and the ledger stores what CATIA used.
Sub RenameShape(obj, nm)
  On Error Resume Next
  If nm <> "" Then obj.Name = nm
  Err.Clear
End Sub

Function EnsureGeoset(nm)
  Dim hbs, h, created
  On Error Resume Next
  Set EnsureGeoset = Nothing
  Set hbs = gPart.HybridBodies
  For Each h In hbs
    If h.Name = nm Then
      Set EnsureGeoset = h
      Exit Function
    End If
  Next
  Set created = hbs.Add()
  If Err.Number <> 0 Then
    Fail "cannot create geometrical set :: " & nm & " :: " & Err.Description
    Err.Clear
    Exit Function
  End If
  created.Name = nm
  Emit "geoset", nm
  Set EnsureGeoset = created
  Err.Clear
End Function

Sub BeginOpenSet(nm)
  Dim newSet
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  Set newSet = EnsureGeoset(nm)
  If newSet Is Nothing Then Exit Sub
  Set gHb = newSet
  Err.Clear
End Sub

Sub BeginSection(nm)
  Dim pts
  On Error Resume Next
  Set pts = CreateObject("Scripting.Dictionary")
  gSectPts.Remove nm
  gSectPts.Add nm, pts
  Err.Clear
End Sub

Sub AddPt(x, y, z)
  Dim p, pts, key
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  Set p = gHsf.AddNewPointCoord(x, y, z)
  If Err.Number <> 0 Then
    Fail "AddNewPointCoord(" & x & "," & y & "," & z & ") :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  gHb.AppendHybridShape p
  If Err.Number <> 0 Then
    Fail "AppendHybridShape(point) :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  gTrash.Add gTrash.Count, p
  key = gSectPts.Count
  Err.Clear
End Sub

' Points are appended to the section named by the most recent BeginSection.
Sub AddSectionPt(section, x, y, z)
  Dim p, pts
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  Set p = gHsf.AddNewPointCoord(x, y, z)
  If Err.Number <> 0 Then
    Fail "AddNewPointCoord :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  gHb.AppendHybridShape p
  If Err.Number <> 0 Then
    Fail "AppendHybridShape(point) :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  gTrash.Add gTrash.Count, p
  Set pts = gSectPts(section)
  pts.Add pts.Count, p
  Err.Clear
End Sub

' Build a spline through a section's points. Requires a successful Update first.
Sub MakeSpline(section, closed, feature)
  Dim pts, s, i, n
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  Set pts = gSectPts(section)
  n = pts.Count
  Emit "splineInput_" & section, "points=" & n & "; closed=" & closed & "; document=" & gDoc.Name
  If n < 2 Then
    Fail "section " & section & " has " & n & " point(s); a spline needs at least 2"
    Exit Sub
  End If
  Set s = gHsf.AddNewSpline()
  If Err.Number <> 0 Then
    Fail "AddNewSpline :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  For i = 0 To n - 1
    s.AddPoint gPart.CreateReferenceFromObject(pts(i))
    If Err.Number <> 0 Then
      Fail "spline.AddPoint #" & i & " :: " & Err.Description
      Err.Clear
      Exit Sub
    End If
  Next
  s.SetClosing closed
  If Err.Number <> 0 Then
    Fail "spline.SetClosing :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  gHb.AppendHybridShape s
  If Err.Number <> 0 Then
    Fail "AppendHybridShape(spline) :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  gTrash.Add gTrash.Count, s
  If gSecs.Exists(section) Then gSecs.Remove section
  gSecs.Add section, s
  RenameShape s, section
  Emit "section_" & section, s.Name
  Emit "splineType_" & section, TypeName(s)
  If feature <> "" Then
    If gFeats.Exists(feature) Then gFeats.Remove feature
    gFeats.Add feature, s
    Emit "feature_" & feature, s.Name
  End If
  Err.Clear
End Sub

Sub MakeLine(feature, x1, y1, z1, x2, y2, z2)
  Dim p1, p2, ln
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  Set p1 = gHsf.AddNewPointCoord(x1, y1, z1)
  gHb.AppendHybridShape p1
  Set p2 = gHsf.AddNewPointCoord(x2, y2, z2)
  gHb.AppendHybridShape p2
  Set ln = gHsf.AddNewLinePtPt(gPart.CreateReferenceFromObject(p1), gPart.CreateReferenceFromObject(p2))
  If Err.Number <> 0 Then
    Fail "AddNewLinePtPt :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  gHb.AppendHybridShape ln
  gTrash.Add gTrash.Count, p1
  gTrash.Add gTrash.Count, p2
  gTrash.Add gTrash.Count, ln
  If gFeats.Exists(feature) Then gFeats.Remove feature
  gFeats.Add feature, ln
  RenameShape ln, feature
  Emit "feature_" & feature, ln.Name
  Err.Clear
End Sub

Sub MakePointFeature(feature, x, y, z)
  Dim p
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  Set p = gHsf.AddNewPointCoord(x, y, z)
  If Err.Number <> 0 Then
    Fail "AddNewPointCoord :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  gHb.AppendHybridShape p
  gTrash.Add gTrash.Count, p
  If gFeats.Exists(feature) Then gFeats.Remove feature
  gFeats.Add feature, p
  RenameShape p, feature
  Emit "feature_" & feature, p.Name
  Err.Clear
End Sub

Sub MakePlaneOffset(feature, baseName, offset, reverse)
  Dim base, pl
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  If baseName = "XY" Then
    Set base = gPart.OriginElements.PlaneXY
  ElseIf baseName = "YZ" Then
    Set base = gPart.OriginElements.PlaneYZ
  ElseIf baseName = "ZX" Then
    Set base = gPart.OriginElements.PlaneZX
  Else
    Fail "unknown base plane :: " & baseName
    Exit Sub
  End If
  Set pl = gHsf.AddNewPlaneOffset(base, offset, reverse)
  If Err.Number <> 0 Then
    Fail "AddNewPlaneOffset :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  gHb.AppendHybridShape pl
  gTrash.Add gTrash.Count, pl
  If gFeats.Exists(feature) Then gFeats.Remove feature
  gFeats.Add feature, pl
  RenameShape pl, feature
  Emit "feature_" & feature, pl.Name
  Err.Clear
End Sub

Sub MakeExtrude(feature, section, limit1, limit2, planeName)
  Dim direction, ex, source
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  If planeName = "XY" Then
    Set direction = gHsf.AddNewDirectionByCoord(0, 0, 1)
  ElseIf planeName = "YZ" Then
    Set direction = gHsf.AddNewDirectionByCoord(1, 0, 0)
  Else
    Set direction = gHsf.AddNewDirectionByCoord(0, 1, 0)
  End If
  Set source = gPart.CreateReferenceFromObject(gSecs(section))
  Set ex = gHsf.AddNewExtrude(source, limit1, limit2, direction)
  If Err.Number <> 0 Then
    Fail "AddNewExtrude :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  gHb.AppendHybridShape ex
  gTrash.Add gTrash.Count, ex
  If gFeats.Exists(feature) Then gFeats.Remove feature
  gFeats.Add feature, ex
  Err.Clear
End Sub

Sub MakePolygon(section, feature)
  Dim pts, n, i, ln, wire, refs()
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  Set pts = gSectPts(section)
  n = pts.Count
  If n < 3 Then
    Fail "a polygon needs at least three vertices"
    Exit Sub
  End If
  ReDim refs(n - 1)
  For i = 0 To n - 1
    Set ln = gHsf.AddNewLinePtPt(gPart.CreateReferenceFromObject(pts(i)), gPart.CreateReferenceFromObject(pts((i + 1) Mod n)))
    Chk "polygon edge factory"
    If gFatal <> "" Then Exit Sub
    gHb.AppendHybridShape ln
    Chk "polygon append edge"
    If gFatal <> "" Then Exit Sub
    gTrash.Add gTrash.Count, ln
    Set refs(i) = gPart.CreateReferenceFromObject(ln)
    Chk "polygon reference"
    If gFatal <> "" Then Exit Sub
  Next
  Set wire = gHsf.AddNewJoin(refs(0), refs(1))
  Chk "polygon join factory"
  If gFatal <> "" Then Exit Sub
  gHb.AppendHybridShape wire
  Chk "polygon append join"
  If gFatal <> "" Then Exit Sub
  gTrash.Add gTrash.Count, wire
  For i = 2 To n - 1
    wire.AddElement refs(i)
    Chk "polygon Join.AddElement"
    If gFatal <> "" Then Exit Sub
  Next
  wire.SetConnex True
  Chk "polygon connexity"
  If gFatal <> "" Then Exit Sub
  wire.SetDeviation 0.001
  Chk "polygon join settings"
  If gFatal <> "" Then Exit Sub
  gPart.UpdateObject wire
  Chk "polygon update"
  If gFatal <> "" Then Exit Sub
  RenameShape wire, section
  If gSecs.Exists(section) Then gSecs.Remove section
  gSecs.Add section, wire
  If gFeats.Exists(feature) Then gFeats.Remove feature
  gFeats.Add feature, wire
End Sub

' CATIA SPA Area/Volume are SI units. Convert diagnostic values to mm2/mm3.
' A feature marker alone is insufficient: update and measure before acknowledging completion.
Sub VerifyFeature(feature, expected)
  Dim obj, spa, meas, amount, featureType
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  If Not gFeats.Exists(feature) Then
    Fail "missing final feature :: " & feature
    Exit Sub
  End If
  Set obj = gFeats(feature)
  gPart.UpdateObject obj
  Chk "verify update " & feature
  If gFatal <> "" Then Exit Sub
  If expected = "auto" Then
    featureType = gHsf.GetGeometricalFeatureType(gPart.CreateReferenceFromObject(obj))
    Chk "detect geometry type " & feature
    If gFatal <> "" Then Exit Sub
    Select Case featureType
      Case 1, 6: expected = "reference"
      Case 2, 3, 4: expected = "curve"
      Case 5: expected = "surface"
      Case 7: expected = "solid"
      Case Else
        Fail "unresolved geometry type :: " & feature
        Exit Sub
    End Select
    Emit "geometryType_" & feature, expected
  End If
  If expected <> "reference" Then
    If TypeName(obj) = "Sketch" And expected = "curve" Then
      amount = SketchPerimeter(obj, feature)
    Else
    Set spa = gDoc.GetWorkbench("SPAWorkbench")
    Set meas = spa.GetMeasurable(gPart.CreateReferenceFromObject(obj))
    Chk "verify measurable " & feature
    If gFatal <> "" Then Exit Sub
    If expected = "solid" Then
      amount = meas.Volume
    ElseIf expected = "surface" Then
      amount = meas.Area
    Else
      amount = meas.Length
    End If
    End If
    Chk "verify " & expected & " " & feature
    If gFatal <> "" Then Exit Sub
    If Not IsNumeric(amount) Then
      Fail "non-numeric geometry measurement :: " & feature
      Exit Sub
    End If
    If CDbl(amount) <= 0 Then
      Fail "empty " & expected & " :: " & feature
      Exit Sub
    End If
    If expected = "solid" Then
      Emit "volumeMm3_" & feature, Replace(CStr(CDbl(amount) * 1000000000), ",", ".")
    ElseIf expected = "surface" Then
      Emit "areaMm2_" & feature, Replace(CStr(CDbl(amount) * 1000000), ",", ".")
    End If
  End If
  Emit "feature_" & feature, obj.Name
  Emit "verified_" & feature, "true"
  Err.Clear
End Sub

Sub MakeLoft(feature, sectionList)
  Dim parts, lo, i
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  parts = Split(sectionList, "|")
  If UBound(parts) < 1 Then
    Fail "a loft needs at least two sections, got: " & sectionList
    Exit Sub
  End If
  Set lo = gHsf.AddNewLoft()
  If Err.Number <> 0 Then
    Fail "AddNewLoft :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  For i = 0 To UBound(parts)
    If Not gSecs.Exists(parts(i)) Then
      Fail "loft section not built :: " & parts(i)
      Exit Sub
    End If
    lo.AddSectionToLoft gPart.CreateReferenceFromObject(gSecs(parts(i))), 1, Nothing
    If Err.Number <> 0 Then
      Fail "AddSectionToLoft(" & parts(i) & ") :: " & Err.Description
      Err.Clear
      Exit Sub
    End If
  Next
  lo.SectionCoupling = 1
  gHb.AppendHybridShape lo
  If Err.Number <> 0 Then
    Fail "AppendHybridShape(loft) :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  gTrash.Add gTrash.Count, lo
  If gFeats.Exists(feature) Then gFeats.Remove feature
  gFeats.Add feature, lo
  RenameShape lo, feature
  Emit "feature_" & feature, lo.Name
  Err.Clear
End Sub

Sub MakeJoin(feature, aName, bName)
  Dim jn
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  If Not (gFeats.Exists(aName) And gFeats.Exists(bName)) Then
    Fail "join needs two existing features"
    Exit Sub
  End If
  Set jn = gHsf.AddNewJoin(gPart.CreateReferenceFromObject(gFeats(aName)), gPart.CreateReferenceFromObject(gFeats(bName)))
  If Err.Number <> 0 Then
    Fail "AddNewJoin :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  gHb.AppendHybridShape jn
  gTrash.Add gTrash.Count, jn
  If gFeats.Exists(feature) Then gFeats.Remove feature
  gFeats.Add feature, jn
  RenameShape jn, feature
  Emit "feature_" & feature, jn.Name
  Err.Clear
End Sub

' ---- update / rollback / persistence ----
' CAUTION: Part.HasUpdate does not exist in this CATIA build, so pending-update state is observed
' only through the Update call itself: a model that cannot update raises here, with the tag naming
' the element whose build failed.
Sub UpdateNow(tag)
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  Emit "updateBegin", tag & " :: document=" & gDoc.Name
  gPart.Update
  If Err.Number <> 0 Then
    Fail tag & " :: CATIA update failed :: " & Err.Number & " :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  Emit "updated", tag
  Err.Clear
End Sub

Sub DropFeature(obj)
  Dim sel
  On Error Resume Next
  Set sel = gDoc.Selection
  sel.Clear
  sel.Add obj
  If Err.Number = 0 Then
    sel.Delete
    If Err.Number = 0 Then Emit "dropped", obj.Name
  End If
  sel.Clear
  Err.Clear
End Sub

Sub RollbackTrash()
  Dim i
  On Error Resume Next
  If gTrash.Count = 0 Then Exit Sub
  For i = gTrash.Count - 1 To 0 Step -1
    DropFeature gTrash(i)
  Next
  gPart.Update
  Err.Clear
  Note "attempted cleanup of " & gTrash.Count & " newly created feature(s); inspect the CATIA session after failure"
End Sub

' Only NewDocument sets this ownership flag; existing documents still use feature cleanup.
' Closing the held new-document object avoids thousands of slow point deletions after failure.
Sub CleanupFailedBuild()
  On Error Resume Next
  If gOwnedDocument And Not gDoc Is Nothing Then
    Err.Clear
    gDoc.Close
    If Err.Number = 0 Then
      Emit "discardedNewDocument", "true"
      Emit "rolledBack", "true"
      Set gTrash = CreateObject("Scripting.Dictionary")
      Set gDoc = Nothing
      gOwnedDocument = False
    Else
      Emit "cleanupError", "cannot close owned new document :: " & Err.Description
    End If
    Err.Clear
  Else
    RollbackTrash
    Emit "rolledBack", "true"
  End If
End Sub

' The no-overwrite rule is enforced in JavaScript (the target path is chosen to be free); this
' helper only reports whether CATIA could actually write the file.
Sub SaveAsChecked(path)
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  If gDoc.FullName <> "" And InStr(gDoc.FullName, "\\") > 0 Then
    Fail "refusing to save: this document already has a file on disk :: " & gDoc.FullName
    Exit Sub
  End If
  If gFso.FileExists(path) Then
    Fail "refusing to overwrite existing file :: " & path
    Exit Sub
  End If
  gDoc.SaveAs path
  If Err.Number <> 0 Then
    Fail "SaveAs failed :: " & path & " :: " & Err.Number & " :: " & Err.Description & " (a CATIA instance started by a restricted process cannot write files)"
    Err.Clear
    Exit Sub
  End If
  Emit "saved", gDoc.FullName
  Err.Clear
End Sub

Sub ExportChecked(path, format)
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  If gFso.FileExists(path) Then
    Fail "refusing to overwrite existing export :: " & path
    Exit Sub
  End If
  gDoc.ExportData path, format
  If Err.Number <> 0 Then
    Fail "export failed :: " & path & " :: " & Err.Number & " :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  Emit "exported", path
  Err.Clear
End Sub

' ---- measurement ----
' Bind an existing feature (created by an earlier script) into this script's feature map.
Sub BindInGeoset(h, nm)
  Dim s, child
  On Error Resume Next
  If gFeats.Exists(nm) Then Exit Sub
  For Each s In h.HybridShapes
    If s.Name = nm Then
      gFeats.Add nm, s
      Exit Sub
    End If
  Next
  Err.Clear
  For Each s In h.HybridSketches
    If s.Name = nm Then
      gFeats.Add nm, s
      Exit Sub
    End If
  Next
  Err.Clear
  For Each child In h.HybridBodies
    BindInGeoset child, nm
    If gFeats.Exists(nm) Then Exit Sub
  Next
  Err.Clear
End Sub

Sub BindFeature(nm)
  Dim h, s, b
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  If gFeats.Exists(nm) Then Exit Sub
  For Each s In gPart.AxisSystems
    If s.Name = nm Then
      gFeats.Add nm, s
      Exit Sub
    End If
  Next
  For Each b In gPart.Bodies
    For Each s In b.Sketches
      If s.Name = nm Then
        gFeats.Add nm, s
        Exit Sub
      End If
    Next
    Err.Clear
    For Each s In b.Shapes
      If s.Name = nm Then
        gFeats.Add nm, s
        Exit Sub
      End If
    Next
    For Each h In b.HybridBodies
      BindInGeoset h, nm
      If gFeats.Exists(nm) Then Exit Sub
    Next
  Next
  For Each h In gPart.HybridBodies
    BindInGeoset h, nm
    If gFeats.Exists(nm) Then Exit Sub
  Next
  Fail "no feature named " & nm & " in " & gDoc.Name
  Err.Clear
End Sub

Sub MeasureDistance(featureA, featureB, key)
  Dim spa, meas, refA, refB, distanceValue
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  Set spa = gDoc.GetWorkbench("SPAWorkbench")
  If spa Is Nothing Then
    Fail "SPA workbench unavailable"
    Exit Sub
  End If
  If Not (gFeats.Exists(featureA) And gFeats.Exists(featureB)) Then
    Fail "measure needs two existing features :: " & featureA & " / " & featureB
    Exit Sub
  End If
  Emit "distanceFeatureA", featureA & " :: " & TypeName(gFeats(featureA))
  Emit "distanceFeatureB", featureB & " :: " & TypeName(gFeats(featureB))
  Emit "distanceDocument", gDoc.Name
  Set refA = gPart.CreateReferenceFromObject(gFeats(featureA))
  Chk "distance CreateReference A"
  If gFatal <> "" Then Exit Sub
  Set refB = gPart.CreateReferenceFromObject(gFeats(featureB))
  Chk "distance CreateReference B"
  If gFatal <> "" Then Exit Sub
  Set meas = spa.GetMeasurable(refA)
  Chk "distance GetMeasurable A"
  If gFatal <> "" Then Exit Sub
  Emit "distanceReferenceTypes", TypeName(refA) & " / " & TypeName(refB)
  Emit "distanceMeasurableType", TypeName(meas)
  distanceValue = meas.GetMinimumDistance(refB)
  If Err.Number <> 0 Then
    Fail "GetMinimumDistance failed :: " & Err.Number & " :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  If Not IsNumeric(distanceValue) Then
    Fail "GetMinimumDistance returned non-numeric data"
    Exit Sub
  End If
  If CDbl(distanceValue) < 0 Then
    Fail "GetMinimumDistance returned negative distance"
    Exit Sub
  End If
  Emit key, distanceValue
  Err.Clear
End Sub

Sub MeasureFeatureLength(feature, key)
  Dim spa, meas
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  Set spa = gDoc.GetWorkbench("SPAWorkbench")
  Set meas = spa.GetMeasurable(gPart.CreateReferenceFromObject(gFeats(feature)))
  Emit key, meas.Length
  If Err.Number <> 0 Then
    Fail "Length failed :: " & Err.Description
    Err.Clear
  End If
  Err.Clear
End Sub

Sub MeasureFeatureArea(feature, key)
  Dim spa, meas
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  Set spa = gDoc.GetWorkbench("SPAWorkbench")
  Set meas = spa.GetMeasurable(gPart.CreateReferenceFromObject(gFeats(feature)))
  Emit key, meas.Area
  If Err.Number <> 0 Then
    Fail "Area failed :: " & Err.Description
    Err.Clear
  End If
  Err.Clear
End Sub

' ---- inspection ----
' Reports structure, not construction detail: a built wing carries hundreds of points, and
' listing them buries the features that actually describe the model.
Sub DescribePart()
  Dim h, s, i, pts, b
  On Error Resume Next
  Emit "doc", gDoc.Name
  For Each s In gPart.AxisSystems
    Emit "feature", "AxisSystems/" & s.Name & " <AxisSystem>"
  Next
  Emit "path", gDoc.FullName
  For Each b In gPart.Bodies
    For Each s In b.Sketches
      Emit "feature", b.Name & "/" & s.Name & " <Sketch>"
    Next
  Next
  Emit "hybridBodyCount", gPart.HybridBodies.Count
  For Each h In gPart.HybridBodies
    pts = 0
    For i = 1 To h.HybridShapes.Count
      Set s = h.HybridShapes.Item(i)
      If TypeName(s) = "HybridShapePointCoord" Then
        pts = pts + 1
      Else
        Emit "feature", h.Name & "/" & s.Name & " <" & TypeName(s) & ">"
      End If
    Next
    Emit "body", h.Name & " [" & h.HybridShapes.Count & " shapes, " & pts & " points]"
  Next
  Err.Clear
End Sub
Sub ReadSketchEnds(geom, ends, nm)
  Dim a, b, xy(1), firstError
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  Err.Clear
  geom.GetEndPoints ends
  If Err.Number = 0 Then Exit Sub
  firstError = Err.Number
  Err.Clear
  Set a = geom.StartPoint
  Chk "sketch read StartPoint " & nm
  If gFatal <> "" Then Exit Sub
  a.GetCoordinates xy
  Chk "sketch read start coordinates " & nm
  If gFatal <> "" Then Exit Sub
  ends(0) = xy(0): ends(1) = xy(1)
  Set b = geom.EndPoint
  Chk "sketch read EndPoint " & nm
  If gFatal <> "" Then Exit Sub
  b.GetCoordinates xy
  Chk "sketch read end coordinates " & nm
  If gFatal <> "" Then Exit Sub
  ends(2) = xy(0): ends(3) = xy(1)
  Note "sketch endpoints read via Point2D after GetEndPoints error " & firstError & " :: " & nm
End Sub

Function SketchPerimeter(sk, nm)
  Dim geom, ends(3), total, count, isConstruction
  On Error Resume Next
  total = 0: count = 0
  For Each geom In sk.GeometricElements
    If TypeName(geom) = "Line2D" Then
      isConstruction = geom.Construction
      Chk "sketch measure construction flag " & nm
      If gFatal <> "" Then Exit For
      If Not isConstruction Then
        ReadSketchEnds geom, ends, nm
        If gFatal <> "" Then Exit For
        total = total + Sqr((ends(2)-ends(0))^2 + (ends(3)-ends(1))^2)
        count = count + 1
      End If
    End If
  Next
  If count < 1 Then Fail "sketch has no measured line edges :: " & nm
  SketchPerimeter = total
End Function

' r11: real line sketches, native coincidence plus requested dimensions/orientations.
' No endpoint setters: the r5 setter path failed with 438 in a user report.
Sub MakeSketch(nm, planeName, xs, ys, axis, planeOffset, cEdges, cValues, cTypes, cOthers, closed)
  Dim plane, sk, f2d, i, j, n, lastEdge, lines(), c, refLine, refOther
  Dim ends(3), actualAxis(8), pa, pb, countBefore, joinCount, statuses, cStatus, addedCount
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  Emit "attempted_" & nm, "Sketcher"
  If Abs(planeOffset) > 0.0000001 Then
    BeginOpenSet "Aero_Reference"
    MakePlaneOffset nm & "__support", planeName, planeOffset, False
    UpdateNow nm & " support"
    If gFatal <> "" Then Exit Sub
    Set plane = gPart.CreateReferenceFromObject(gFeats(nm & "__support"))
  Else
    Select Case UCase(planeName)
      Case "XY": Set plane = gPart.OriginElements.PlaneXY
      Case "YZ": Set plane = gPart.OriginElements.PlaneYZ
      Case "ZX": Set plane = gPart.OriginElements.PlaneZX
      Case Else: Fail "invalid sketch plane"
    End Select
  End If
  Chk "sketch plane " & nm
  If gFatal <> "" Then Exit Sub
  gPart.InWorkObject = gPart.MainBody
  Chk "sketch active body " & nm
  If gFatal <> "" Then Exit Sub
  Set sk = gPart.MainBody.Sketches.Add(plane)
  Chk "Body.Sketches.Add " & nm
  If gFatal <> "" Then Exit Sub
  gTrash.Add gTrash.Count, sk
  sk.Name = nm
  Chk "sketch rename " & nm
  sk.SetAbsoluteAxisData axis
  Chk "sketch axes " & nm
  If gFatal <> "" Then Exit Sub
  countBefore = sk.Constraints.Count
  Chk "sketch initial constraint count " & nm
  If gFatal <> "" Then Exit Sub
  Set f2d = sk.OpenEdition
  Chk "sketch OpenEdition " & nm
  ' All exits after OpenEdition go through CloseEdition.
  n = UBound(xs): lastEdge = n - 1: joinCount = 0
  If closed Then lastEdge = n
  ReDim lines(lastEdge)
  If gFatal = "" Then
    For i = 0 To lastEdge
      j = (i + 1) Mod (n + 1)
      Set lines(i) = f2d.CreateLine(xs(i), ys(i), xs(j), ys(j))
      Chk "sketch edge " & nm & " #" & i
      If gFatal <> "" Then Exit For
      lines(i).Construction = False
      Chk "sketch real edge " & nm & " #" & i
      If gFatal <> "" Then Exit For
    Next
  End If
  If gFatal = "" Then
    For i = 0 To lastEdge
      j = (i + 1) Mod (lastEdge + 1)
      If closed Or i < lastEdge Then
        Set pa = lines(i).EndPoint
        Chk "sketch junction end " & nm & " #" & i
        If gFatal <> "" Then Exit For
        Set pb = lines(j).StartPoint
        Chk "sketch junction start " & nm & " #" & i
        If gFatal <> "" Then Exit For
        Set refLine = gPart.CreateReferenceFromObject(pa)
        Chk "sketch junction end reference " & nm
        If gFatal <> "" Then Exit For
        Set refOther = gPart.CreateReferenceFromObject(pb)
        Chk "sketch junction start reference " & nm
        If gFatal <> "" Then Exit For
        Set c = sk.Constraints.AddBiEltCst(2, refLine, refOther)
        Chk "sketch coincidence " & nm & " #" & i
        If gFatal <> "" Then Exit For
        c.Name = nm & "__coincidence_" & i
        Chk "sketch coincidence name " & nm
        If gFatal <> "" Then Exit For
        joinCount = joinCount + 1
      End If
    Next
  End If
  If gFatal = "" Then
    For i = 0 To UBound(cEdges)
      Set refLine = gPart.CreateReferenceFromObject(lines(cEdges(i)))
      Chk "sketch constraint reference " & nm
      If gFatal <> "" Then Exit For
      If cOthers(i) >= 0 Then
        Set refOther = gPart.CreateReferenceFromObject(lines(cOthers(i)))
        Chk "sketch second constraint reference " & nm
        If gFatal <> "" Then Exit For
        Set c = sk.Constraints.AddBiEltCst(cTypes(i), refLine, refOther)
      ElseIf cTypes(i) = 5 Then
        Set c = sk.Constraints.AddMonoEltCst(5, refLine)
      Else
        Set c = sk.Constraints.AddMonoEltCst(cTypes(i), refLine)
      End If
      Chk "sketch constraint type " & cTypes(i) & " :: " & nm
      If gFatal <> "" Then Exit For
      c.Name = nm & "__constraint_" & i
      Chk "sketch constraint name " & nm
      If gFatal <> "" Then Exit For
      If cTypes(i) = 5 Then
        c.Mode = 0
        Chk "sketch driving dimension " & nm
        If gFatal <> "" Then Exit For
        c.Dimension.Value = cValues(i)
        Chk "sketch constraint value " & nm
        If gFatal <> "" Then Exit For
      End If
    Next
  End If
  sk.CloseEdition
  Chk "sketch CloseEdition " & nm
  If gFatal <> "" Then Exit Sub
  gPart.UpdateObject sk
  Chk "sketch update " & nm
  If gFatal <> "" Then Exit Sub
  sk.GetAbsoluteAxisData actualAxis
  Chk "sketch read axes " & nm
  If gFatal <> "" Then Exit Sub
  For i = 0 To 8
    If Abs(actualAxis(i)-axis(i)) > 0.000001 Then Fail "sketch axes differ from requested frame :: " & nm
  Next
  If gFatal <> "" Then Exit Sub
  For i = 0 To lastEdge
    j = (i + 1) Mod (n + 1)
    ReadSketchEnds lines(i), ends, nm & " #" & i
    If gFatal <> "" Then Exit Sub
    If Abs(ends(0)-xs(i)) > 0.000001 Or Abs(ends(1)-ys(i)) > 0.000001 Or Abs(ends(2)-xs(j)) > 0.000001 Or Abs(ends(3)-ys(j)) > 0.000001 Then
      Fail "sketch solver moved a profile edge; bounds invalid :: " & nm & " #" & i
      Exit Sub
    End If
  Next
  i = sk.Constraints.Count - countBefore
  Chk "sketch final constraint count " & nm
  If gFatal <> "" Then Exit Sub
  If i <> joinCount + UBound(cEdges) + 1 Then
    Fail "sketch constraint count differs from request :: " & nm
    Exit Sub
  End If
  addedCount = i
  statuses = ""
  For i = countBefore + 1 To sk.Constraints.Count
    Set c = sk.Constraints.Item(i)
    Chk "sketch read constraint " & nm
    If gFatal <> "" Then Exit Sub
    cStatus = c.Status
    Chk "sketch read constraint status " & nm
    If gFatal <> "" Then Exit Sub
    If statuses <> "" Then statuses = statuses & ","
    statuses = statuses & cStatus
    ' CatConstraintStatus: catCstStatusOK = 0. Satisfied is not fully constrained.
    If cStatus <> 0 Then
      Emit "sketchConstraintStatuses_" & nm, statuses
      Fail "sketch constraint not satisfied :: " & nm & " #" & i & " status=" & cStatus
      Exit Sub
    End If
    j = c.IsInactive
    Chk "sketch read constraint activity " & nm
    If gFatal <> "" Then Exit Sub
    If j Then
      Fail "sketch constraint inactive :: " & nm & " #" & i
      Exit Sub
    End If
  Next
  Emit "sketchConstraintStatuses_" & nm, statuses
  Emit "sketchConstraints_" & nm, addedCount
  Emit "sketchCoincidences_" & nm, joinCount
  Emit "sketchEdges_" & nm, lastEdge + 1
  Emit "sketchEndpointsVerified_" & nm, "true"
  Emit "sketchConstraintsSatisfied_" & nm, "true"
  Emit "sketchClosedInput_" & nm, closed
  If gFeats.Exists(nm) Then gFeats.Remove nm
  gFeats.Add nm, sk
  Emit "feature_" & nm, sk.Name
  Note "line sketch " & nm & " edges=" & (lastEdge+1) & " constraints=" & addedCount
End Sub

' ==== end prelude ====
`;

/**
 * Compose a complete, runnable CATIA automation script.
 * @param options - prelude, op body, report path, and audit labels.
 * @returns the script source.
 */
export function assembleScript(options) {
  const { prelude, body, reportPath, op, title } = options;
  const header = prelude
    .replace('@@REPORT@@', vbsStr(reportPath))
    .replace('@@OP@@', vbsStr(op))
    .replace('@@TITLE@@', vbsStr(title ?? op));
  const epilogue = [
    '',
    "' ==== epilogue ====",
    'If gFatal <> "" Then',
    '  Emit "RESULT", "error"',
    '  Emit "ERROR", gFatal',
    '  If Not gKeepGeometry Then',
    '    CleanupFailedBuild',
    '  End If',
    '  Emit "RESULT", "error"',
    'Else',
    '  Emit "RESULT", "ok"',
    'End If',
    'If gAttached Then CATIA.DisplayFileAlerts = gOriginalAlerts',
    'WScript.Quit 0',
    '',
  ].join('\n');
  return `${header}\n' ==== body ====\n${body.trimEnd()}\n${epilogue}`;
}

/** @returns the shared prelude source. */
export function ensurePrelude() {
  return PRELUDE;
}

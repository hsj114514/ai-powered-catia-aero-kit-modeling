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
  return `"${String(value).replace(/"/g, '""')}"`;
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
Dim CATIA, gDoc, gPart, gHsf, gHb, gSpa
Dim gTrash, gSecs, gFeats, gSectPts

Set gFso = CreateObject("Scripting.FileSystemObject")
gReportPath = @@REPORT@@
gOp = @@OP@@
gTitle = @@TITLE@@
gFatal = ""
gStepSeq = 0
Set gTrash = CreateObject("Scripting.Dictionary")
Set gSecs = CreateObject("Scripting.Dictionary")
Set gFeats = CreateObject("Scripting.Dictionary")
Set gSectPts = CreateObject("Scripting.Dictionary")
gFso.CreateTextFile(gReportPath, True).Close

' Script-level error handling. VBScript scopes On Error to the procedure it appears in, so this
' covers the generated operation body while every helper carries its own.
On Error Resume Next

Sub Emit(k, v)
  Dim f, s
  On Error Resume Next
  s = Replace(Replace(CStr(v), vbCr, " "), vbLf, " ")
  Set f = gFso.OpenTextFile(gReportPath, 8, True)
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
  Set d = CATIA.Documents.Add("Part")
  If Err.Number <> 0 Or d Is Nothing Then
    Fail "cannot create a part document :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
  Set gDoc = d
  Set gPart = d.Part
  Set gHsf = gPart.HybridShapeFactory
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
  Dim base, ex
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  If planeName = "XY" Then
    Set base = gPart.OriginElements.PlaneXY
  ElseIf planeName = "YZ" Then
    Set base = gPart.OriginElements.PlaneYZ
  Else
    Set base = gPart.OriginElements.PlaneZX
  End If
  Set ex = gHsf.AddNewExtrude(gSecs(section), limit1, limit2, base, False)
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
  Emit "updated", tag
  gPart.Update
  If Err.Number <> 0 Then
    Fail tag & " :: CATIA update failed :: " & Err.Number & " :: " & Err.Description
    Err.Clear
    Exit Sub
  End If
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
  Note "rolled back " & gTrash.Count & " feature(s) so the document stays at its last valid state"
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
Sub BindFeature(nm)
  Dim h, s
  On Error Resume Next
  If gFatal <> "" Then Exit Sub
  If gFeats.Exists(nm) Then Exit Sub
  For Each h In gPart.HybridBodies
    For Each s In h.HybridShapes
      If s.Name = nm Then
        gFeats.Add nm, s
        Exit Sub
      End If
    Next
  Next
  Fail "no feature named " & nm & " in " & gDoc.Name
  Err.Clear
End Sub

Sub MeasureDistance(featureA, featureB, key)
  Dim spa, meas
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
  Set meas = spa.GetMeasurable(gPart.CreateReferenceFromObject(gFeats(featureA)))
  Emit key, meas.GetMinimumDistance(gPart.CreateReferenceFromObject(gFeats(featureB)))
  If Err.Number <> 0 Then
    Fail "GetMinimumDistance failed :: " & Err.Description
    Err.Clear
  End If
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
  Dim h, s, i, pts
  On Error Resume Next
  Emit "doc", gDoc.Name
  Emit "path", gDoc.FullName
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
    '  RollbackTrash',
    '  Emit "RESULT", "error"',
    'Else',
    '  Emit "RESULT", "ok"',
    'End If',
    'WScript.Quit 0',
    '',
  ].join('\n');
  return `${header}\n' ==== body ====\n${body.trimEnd()}\n${epilogue}`;
}

/** @returns the shared prelude source. */
export function ensurePrelude() {
  return PRELUDE;
}

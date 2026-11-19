"""Verify the double-click launcher's default paths, including when its output is captured."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
import urllib.request

from mysql_fixture import mysql_schema
from mysql_storage import ROOT


@unittest.skipUnless(os.name == "nt", "Windows launcher")
class WindowsLauncher(unittest.TestCase):
    def test_default_directory_cold_start_and_reuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp).resolve()
            data = project / "data"
            with mysql_schema(data):
                shutil.copyfile(ROOT / "start-studio.ps1", project / "start-studio.ps1")
                # Test the real server without creating a second copy of the workspace.
                (project / "server.py").write_text(
                    f"import sys,runpy\nsys.path.insert(0,{str(ROOT)!r})\n"
                    f"runpy.run_path({str(ROOT/'server.py')!r},run_name='__main__')\n", encoding="utf-8")
                with socket.socket() as sock:
                    sock.bind(("127.0.0.1", 0))
                    port = sock.getsockname()[1]
                cli = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                       str(project/"start-studio.ps1"), "-Port", str(port), "-PythonPath", sys.executable]
                try:
                    cold = subprocess.run(cli, capture_output=True, check=True, timeout=25)
                    self.assertIn(b"EIM PID", cold.stdout)
                    client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                    with client.open(f"http://127.0.0.1:{port}/api/session", timeout=4) as response:
                        session = json.load(response)
                        self.assertTrue(session["setupRequired"])
                        self.assertEqual(session["storage"], "mysql")
                    warm = subprocess.run(cli, capture_output=True, check=True, timeout=10)
                    self.assertNotIn(b"EIM PID", warm.stdout)
                finally:
                    stop = """
                    $listener=Get-NetTCPConnection -LocalPort ([int]$env:INVITE_QA_PORT) -State Listen -ErrorAction SilentlyContinue
                    if ($listener) {
                      $worker=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
                      if ($worker.Name -ne 'python.exe' -or !$worker.CommandLine.Contains($env:INVITE_QA_DATA)) {
                        throw 'Unexpected listener'
                      }
                      Stop-Process -Id $worker.ProcessId -ErrorAction Stop
                      Wait-Process -Id $worker.ProcessId -ErrorAction SilentlyContinue
                    }
                    exit 0"""
                    subprocess.run(["powershell.exe","-NoProfile","-Command",stop], check=True, timeout=20,
                                   env=dict(os.environ, INVITE_QA_PORT=str(port), INVITE_QA_DATA=str(data)))

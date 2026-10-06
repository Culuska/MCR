"""Exercises the security layer over HTTP: lockout, forgot password, reset links, changing a password, ending sessions.
Needs: $TOKEN_DIR with admin.tok and viewer.tok, $DEV_LOG (the dev server's output file, where development reset links are
printed), $SEC_PASSWORD (a strong password for the throw-away user zz-sec@mcr.example) and $SEC_NEW_PASSWORD.
Local use only: it makes and removes a test user.
"""
import os, re, subprocess, sys, time, urllib.error, urllib.request
d = os.environ["TOKEN_DIR"]
sys.argv = [sys.argv[0], f"{d}/admin.tok"]
import form_test as ft
from form_test import submit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMAIL = "zz-sec@mcr.example"
OLD, NEW = os.environ["SEC_PASSWORD"], os.environ["SEC_NEW_PASSWORD"]
LOG = os.environ["DEV_LOG"]
failed = 0


def check(name, got, expect):
    global failed
    ok = expect in got
    failed += 0 if ok else 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       got: {got}"))


def check_not(name, got, bad):
    global failed
    ok = bad not in got and "HTTP 5" not in got
    failed += 0 if ok else 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n       got: {got}"))


def data(mode, **env):
    out = subprocess.run("npx tsx scripts/test-security-data.ts " + mode, cwd=ROOT, shell=True, capture_output=True, text=True, env={**os.environ, **env})
    return out.stdout.strip().splitlines()[-1] if out.stdout.strip() else out.stderr[-300:]


def anon():
    ft.TOKEN = ""


def login(email, pw):
    anon()
    return submit("/login", "password", {"email": email, "password": pw})


def forgot(email):
    anon()
    return submit("/forgot-password", "email", {"email": email})


def mint(who):
    out = subprocess.run(f"npx tsx scripts/session-cookie.ts {who}", cwd=ROOT, shell=True, capture_output=True, text=True)
    return out.stdout.strip().splitlines()[-1]


def get_as(token, path):
    req = urllib.request.Request(ft.BASE + path, headers={"Cookie": f"mcr_session={token}"})
    try:
        r = urllib.request.urlopen(req, timeout=60)
        return r.status, r.geturl(), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, path, ""


def latest_link():
    for _ in range(20):  # the email is sent after the response, so give the server a moment
        links = re.findall(r"development reset link for [^:]+: (http\S+)", open(LOG, errors="ignore").read())
        if links:
            return links[-1]
        time.sleep(0.5)
    return ""


def state():
    import json
    return json.loads(data("state"))


print(data("cleanup"), data("create", SEC_PASSWORD=OLD))

# ---------- signing in ----------
check("a wrong password gets the generic message", login(EMAIL, "Wrong-Password-1!"), "Email or password is not correct.")
check("an unknown email gets exactly the same message", login("nobody-here@mcr.example", "Wrong-Password-1!"), "Email or password is not correct.")
for _ in range(3):
    login(EMAIL, "Wrong-Password-1!")
check("the 5th failure is still answered with the generic message", login(EMAIL, "Wrong-Password-1!"), "Email or password is not correct.")
check("after 5 failures even the RIGHT password is refused", login(EMAIL, OLD), "Too many sign-in attempts")
for _ in range(5):
    login("nobody-here@mcr.example", "Wrong-Password-1!")
check("an unknown email is paused the same way (nothing to learn from it)", login("nobody-here@mcr.example", "Wrong-Password-1!"), "Too many sign-in attempts")
check("the pause was written to the audit trail", " ".join(state()["audit"]), "auth.lockout")
print(data("unlock"))
check_not("the right password works once the pause is cleared", login(EMAIL, OLD), "[ERROR]")  # a successful sign-in redirects, so no form message
anon()
page = ft.get("/login")
check("the sign-in page has a Forgot password link", page, "/forgot-password")

# ---------- forgot password ----------
check("an invalid email shape is rejected politely", forgot("not-an-email"), "Enter your email address.")
reply_real = forgot(EMAIL)
reply_fake = forgot("nobody-here@mcr.example")
check("a registered email gets the neutral message", reply_real, "If that email belongs to an account")
check("an unknown email gets exactly the same message", reply_fake, reply_real.split("] ", 1)[1])
s = state()
check("one reset link exists for the real user", str(s["unusedResets"]), "1")
check("none was created for the unknown email", str(s["unknownEmailResets"]), "0")
link1 = latest_link()
check("a development reset link was produced", link1, "/reset-password/")
token1 = link1.rsplit("/", 1)[-1]
check("the link is a long random token", str(len(token1)), "43")

forgot(EMAIL)
link2 = latest_link()
check("a second request makes a new, different link", str(link2 != link1), "True")
check("only the newest link is still waiting", str(state()["unusedResets"]), "1")
status, _, body = get_as("", "/reset-password/" + token1)
check("the first link no longer works", body, "not valid or has expired")
token2 = link2.rsplit("/", 1)[-1]
status, _, body = get_as("", "/reset-password/" + token2)
check("the newest link shows the new-password form", body, 'name="confirm"')
status, _, body = get_as("", "/reset-password/not-a-real-token")
check("a made-up link is refused", body, "not valid or has expired")
check("the page never prints the token or an account name", str("Security Test" in body), "False")

# ---------- choosing the new password ----------
anon()
page = "/reset-password/" + token2
check("a weak password lists what is wrong", submit(page, "confirm", {"password": "short", "confirm": "short"}), "Use at least 12 characters")
check("a common password is refused", submit(page, "confirm", {"password": "Password123!!", "confirm": "Password123!!"}), "too common")
check("a password containing the email is refused", submit(page, "confirm", {"password": "zz-sec-Mcr-2026!x", "confirm": "zz-sec-Mcr-2026!x"}), "email")
check("mismatched confirmation is refused", submit(page, "confirm", {"password": NEW, "confirm": NEW + "x"}), "do not match")
check("the old password cannot be reused", submit(page, "confirm", {"password": OLD, "confirm": OLD}), "have not used")
result = submit(page, "confirm", {"password": NEW, "confirm": NEW})
check_not("a good password is accepted (the page moves on to sign-in)", result, "[ERROR]")
anon()
check("the old password no longer works", login(EMAIL, OLD), "Email or password is not correct.")
check_not("the new password works", login(EMAIL, NEW), "[ERROR]")
status, _, body = get_as("", page)
check("the used link cannot be used again", body, "not valid or has expired")
s = state()
check("no reset link is left waiting", str(s["unusedResets"]), "0")
check("the reset was audited", " ".join(s["audit"]), "auth.password_reset")
check("the password is stored hashed", str(s["hashLooksLikeBcrypt"]), "True")

forgot(EMAIL)
data("expire")
status, _, body = get_as("", "/reset-password/" + latest_link().rsplit("/", 1)[-1])
check("an expired link is refused", body, "not valid or has expired")

# ---------- changing my own password, and other sessions ending ----------
other = mint(EMAIL)
mine = mint(EMAIL)
time.sleep(2)
status, url, body = get_as(other, "/account")
check("a session works before the change", body, "Change password")
ft.TOKEN = mine
check("a wrong current password is refused", submit("/account", "current", {"current": "Not-My-Password-9!", "password": OLD, "confirm": OLD}), "current password is not correct")
check("a weak new password is refused", submit("/account", "current", {"current": NEW, "password": "abc", "confirm": "abc"}), "Use at least 12 characters")
check("mismatch is refused", submit("/account", "current", {"current": NEW, "password": OLD, "confirm": OLD + "z"}), "do not match")
check("the same password is refused", submit("/account", "current", {"current": NEW, "password": NEW, "confirm": NEW}), "different")
check("a correct change is accepted", submit("/account", "current", {"current": NEW, "password": OLD, "confirm": OLD}), "Password changed")
status, url, body = get_as(other, "/account")
check("the other session was ended by the change", url, "/login")
anon()
check_not("the changed password signs in", login(EMAIL, OLD), "[ERROR]")

# ---------- admin screens ----------
ft.TOKEN = open(f"{d}/admin.tok").read().strip()
page = ft.get("/settings?tab=security")
check("the Security tab shows the email status", page, "Email for password resets")
check("it shows recent sign-ins", page, "Sign-in history")
check("it never prints a password or key", str("EMAIL_PASSWORD=" in page or "pass" + "word=" in page.lower()), "False")
ft.TOKEN = open(f"{d}/viewer.tok").read().strip()
status, url, body = get_as(ft.TOKEN, "/settings?tab=security")
check("a viewer cannot open Settings", url, "/?denied=settings")
ft.TOKEN = open(f"{d}/admin.tok").read().strip()
reply = submit("/settings?tab=people", "id", {}, contains="Email reset link")
check("an admin gets a clear message when email is not set up", reply, "Email is not set up")

print(data("cleanup"))
print("\n" + ("%d FAILED" % failed if failed else "all passed"))
sys.exit(1 if failed else 0)
